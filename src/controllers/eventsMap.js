const { ObjectID } = require('mongodb');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
// const { getQRData, calculateDistance, projectPoint } = require('../utils/parseQR');
const { getQRData, calculateDistance } = require('../utils/parseQR');
const Event = require('../models/oevent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const activityLog = require('./activityLog');
const createRouteOverlay = require('../utils/createRouteOverlay');

// upload a scanned map to the specified event for user :userid
// :maptype is either course or route
// :maptitle is the label to use for each part of multi-part maps (default: '')
// app.post('/events/:eventid/maps/:userid/:maptype(course|route)/:maptitle'
const validateMapUploadPermission = (req, res, next) => {
  const allowedToUploadMap = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.userid));
  if (!allowedToUploadMap) {
    logger('error')(`Error: ${req.user.email} not allowed to upload map for ${req.params.userid}.`);
    return res.status(401).send({ error: 'Not allowed to upload map for this user.' });
  }
  return next();
};
const postMap = (req, res) => {
  logReq(req);
  if (!req.file) {
    logger('error')('Error: postMap request without image attached.');
    return res.status(400).send({ error: 'No map image file attached.' });
  }
  const {
    eventid,
    userid,
    maptype,
    maptitle,
  } = req.params;
  // maptitle parameter should be URIComponent encoded but Express decodes it for you
  const title = maptitle || '';
  // check that event and user ids are appropriate format
  if (!ObjectID.isValid(eventid) || !ObjectID.isValid(userid)) {
    logger('error')('Error uploading map: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  const newFileLocation = path.join('images', 'maps', eventid, req.file.path.split('/').pop());
  // first make sure that the eventid folder exists
  return fs.mkdir(path.join('images', 'maps', eventid), (mkdirErr) => {
    if (mkdirErr && mkdirErr.code !== 'EEXIST') throw mkdirErr;
    // check that there isn't already a file with the same name (i.e. maptitle has been used
    // before in the context of this map, even if it is not it's current 'title')
    fs.access(newFileLocation, (accessFileErr) => {
      if (accessFileErr && accessFileErr.code === 'ENOENT') {
        // i.e. if we get an error that the file doesn't exist, go ahead and rename
        return fs.rename(req.file.path, newFileLocation, (renameErr) => {
          if (renameErr) throw renameErr;
          return fs.readFile(newFileLocation, (err, data) => {
            if (err) throw err;
            // Try to create overlay:
            // will return null if files don't exist, are different sizes, etc.
            // for now, don't worry about confirming through API that overlay has been created
            const filenameBase = newFileLocation.slice(0, newFileLocation.lastIndexOf('-'));
            const routeFilename = filenameBase.concat('-route.jpg');
            const courseFilename = filenameBase.concat('-course.jpg');
            const overlayThreshold = 63;
            // returns a Promise resolving to an overlay (new PNG object) or null if unsuccessful
            // console.log('calling createRouteOverlay');
            createRouteOverlay(routeFilename, courseFilename, overlayThreshold)
              .then((newOverlay) => {
                // console.log('createRouteOverlay completed');
                const overlayFilename = (newOverlay) ? filenameBase.concat('-overlay.png') : null;
                if (newOverlay) {
                  newOverlay
                    .pack()
                    .pipe(fs.createWriteStream(overlayFilename));
                }
                // create thumbnail and extract
                const thumbnailSize = 200; // fit within square box of this dimension in pixels
                const extractWidth = 600; // pixels
                const extractHeight = 100; // pixels
                const thumbnail = newFileLocation.slice(0, -4).concat('-thumb').concat(newFileLocation.slice(-4));
                const extract = newFileLocation.slice(0, -4).concat('-extract').concat(newFileLocation.slice(-4));
                sharp(newFileLocation)
                  .resize(thumbnailSize, thumbnailSize, { fit: 'inside' })
                  .toFile(thumbnail, (thumbErr) => {
                    sharp.cache(false); // stops really confusing behaviour if changing many times
                    if (thumbErr) throw err;
                  });
                sharp(newFileLocation)
                  .metadata()
                  .then((metadata) => {
                    const centreX = Math.floor(metadata.width / 2);
                    const centreY = Math.floor(metadata.height / 2);
                    // check to limit size of extract for small images
                    // (although real maps are unlikely to be this small)
                    const newWidth = Math.min(metadata.width, extractWidth);
                    const newHeight = Math.min(metadata.height, extractHeight);
                    return sharp(newFileLocation)
                      .extract({
                        left: centreX - Math.floor(newWidth / 2),
                        top: centreY - Math.floor(newHeight / 2),
                        width: newWidth,
                        height: newHeight,
                      })
                      .toFile(extract, (extractErr) => {
                        sharp.cache(false); // stops confusing behaviour if changing more than once!
                        if (extractErr) throw err;
                      });
                  });
                // const toPrint = data.toString('hex').match(/../g).join(' ').slice(0, 512);
                // console.log(toPrint);
                // const parsedQR = quickRouteParser.parse(data);
                // console.log(JSON.stringify(parsedQR, null, 2));
                const qRData = getQRData(data);
                let trackCoords = [];
                let trackDistance = 0;
                if (qRData.sessions) { // assume first session, first route for now
                  trackCoords = qRData.sessions.sessionData[0].route[0].waypoints;
                  trackDistance = calculateDistance(trackCoords[0], trackCoords[1]);
                  for (let i = 0; i < trackCoords.length - 2; i += 1) {
                    trackDistance += calculateDistance(trackCoords[i], trackCoords[i + 1]);
                  }
                }
                const trackDistanceK = Math.floor(trackDistance) / 1000;
                // console.log(JSON.stringify(qRData, null, 2));
                return Event.findById(eventid).then((eventToUpdate) => {
                  const fieldsToUpdate = {};
                  const maptypeUpdated = maptype.concat('Updated');
                  const timeUpdated = new Date().getTime().toString();
                  let runnerExists = false;
                  const newRunners = eventToUpdate.runners.map((runner) => {
                    if (runner.user.toString() === userid) {
                      runnerExists = true;
                      let mapExists = false;
                      runner.maps.map((map) => {
                        const newMap = map;
                        if (newMap.title === title) {
                          mapExists = true;
                          newMap[maptype] = newFileLocation;
                          newMap[maptypeUpdated] = timeUpdated;
                          if (newOverlay) {
                            newMap.overlay = overlayFilename;
                            newMap.overlayUpdated = timeUpdated;
                          }
                          if (qRData.isGeocoded) {
                            newMap.isGeocoded = true;
                            newMap.geo = {
                              mapCentre: qRData.mapCentre,
                              mapCorners: qRData.mapCorners,
                              imageCorners: qRData.imageCorners,
                              locationSizePixels: qRData.locationSizePixels,
                              track: trackCoords,
                              distanceRun: trackDistanceK,
                            };
                          }
                        }
                        return newMap;
                      });
                      if (!mapExists) {
                        const mapToAdd = {
                          title,
                          [maptype]: newFileLocation,
                          [maptypeUpdated]: timeUpdated,
                        };
                        if (qRData.isGeocoded) {
                          mapToAdd.isGeocoded = true;
                          mapToAdd.geo = {
                            mapCentre: qRData.mapCentre,
                            mapCorners: qRData.mapCorners,
                            imageCorners: qRData.imageCorners,
                            locationSizePixels: qRData.locationSizePixels,
                            track: trackCoords,
                            distanceRun: trackDistanceK,
                          };
                        }
                        runner.maps.push(mapToAdd);
                      }
                    }
                    return runner;
                  });
                  if (!runnerExists) {
                    const runnerToAdd = {
                      user: userid,
                      maps: {
                        title,
                        [maptype]: newFileLocation,
                        [maptypeUpdated]: timeUpdated,
                      },
                    };
                    if (qRData.isGeocoded) {
                      runnerToAdd.maps.isGeocoded = true;
                      runnerToAdd.maps.geo = {
                        mapCentre: qRData.mapCentre,
                        mapCorners: qRData.mapCorners,
                        imageCorners: qRData.imageCorners,
                        locationSizePixels: qRData.locationSizePixels,
                        track: trackCoords,
                        distanceRun: trackDistanceK,
                      };
                    }
                    newRunners.push(runnerToAdd);
                  }
                  // console.log('runners:', foundEvent.runners);
                  // console.log('newRunners:', newRunners);
                  fieldsToUpdate.runners = newRunners;
                  if (qRData.isGeocoded) {
                    if (!eventToUpdate.locCornerSW || eventToUpdate.locCornerSW.length === 0
                    || !eventToUpdate.locCornerSW[0] || !eventToUpdate.locCornerSW[1]) {
                      fieldsToUpdate.locCornerSW = [qRData.mapCorners.sw.lat,
                        qRData.mapCorners.sw.long];
                    }
                    if (!eventToUpdate.locCornerNW || eventToUpdate.locCornerNW.length === 0
                      || !eventToUpdate.locCornerNW[0] || !eventToUpdate.locCornerNW[1]) {
                      fieldsToUpdate.locCornerNW = [qRData.mapCorners.nw.lat,
                        qRData.mapCorners.nw.long];
                    }
                    if (!eventToUpdate.locCornerNE || eventToUpdate.locCornerNE.length === 0
                      || !eventToUpdate.locCornerNE[0] || !eventToUpdate.locCornerNE[1]) {
                      fieldsToUpdate.locCornerNE = [qRData.mapCorners.ne.lat,
                        qRData.mapCorners.ne.long];
                    }
                    if (!eventToUpdate.locCornerSE || eventToUpdate.locCornerSE.length === 0
                      || !eventToUpdate.locCornerSE[0] || !eventToUpdate.locCornerSE[1]) {
                      fieldsToUpdate.locCornerSE = [qRData.mapCorners.se.lat,
                        qRData.mapCorners.se.long];
                    }
                    if (!eventToUpdate.locLat || eventToUpdate.locLat === '') {
                      fieldsToUpdate.locLat = qRData.mapCentre.lat;
                    }
                    if (!eventToUpdate.locLong || eventToUpdate.locLong === '') {
                      fieldsToUpdate.locLong = qRData.mapCentre.long;
                    }
                  }
                  return Event.findByIdAndUpdate(eventid, { $set: fieldsToUpdate }, { new: true })
                    .populate('owner', '_id displayName')
                    .populate('organisedBy', '_id shortName')
                    .populate('linkedTo', '_id displayName')
                    .populate({
                      path: 'runners.user',
                      select: '_id active displayName fullName regNumber orisId profileImage visibility',
                      populate: { path: 'memberOf', select: '_id shortName' },
                    })
                    .populate({
                      path: 'runners.comments.author',
                      select: '_id displayName fullName regNumber',
                    })
                    .select('-active -__v')
                    .then((updatedEvent) => {
                      // console.log('updatedEvent:', updatedEvent);
                      logger('success')(`Map added to ${updatedEvent.name} by ${req.user.email}.`);
                      activityLog({
                        actionType: 'EVENT_MAP_UPLOADED',
                        actionBy: req.user._id,
                        event: eventid,
                        eventRunner: userid,
                      });
                      // filter out runners that the user isn't allowed to see
                      const requestorRole = req.user.role;
                      // console.log('requestorRole', requestorRole);
                      const requestorId = (requestorRole === 'anonymous')
                        ? null
                        : req.user._id.toString();
                      // console.log('requestorId', requestorId);
                      const requestorClubs = (requestorRole === 'anonymous')
                        ? null
                        : req.user.memberOf.map(club => club._id.toString());
                      const selectedRunners = updatedEvent.runners.filter((runner) => {
                        // console.log('runner.user', runner.user);
                        let canSee = false;
                        if (requestorRole === 'admin' && runner.user.active) canSee = true;
                        if (runner.visibility === 'public') canSee = true;
                        if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
                          if (runner.visibility === 'all') canSee = true;
                          if (requestorId === runner.user._id.toString()) canSee = true;
                          if (runner.visibility === 'club') {
                            const commonClubs = runner.user.memberOf.filter((clubId) => {
                              return requestorClubs.includes(clubId.toString());
                            });
                            if (commonClubs.length > 0) canSee = true;
                          }
                        }
                        return canSee;
                      });
                      // console.log('runners, selectedRunners',
                      // updatedEvent.runners.length, selectedRunners.length);
                      const eventToSend = { ...updatedEvent.toObject(), runners: selectedRunners };
                      return res.status(200).send(eventToSend);
                    })
                    .catch((updateEventErr) => {
                      logger('error')('Error recording updated map references:', updateEventErr.message);
                      return res.status(400).send({ error: updateEventErr.message });
                    });
                });
              });
          });
        });
      }
      // otherwise return an API error
      logger('error')('Error uploading map: file already exists.');
      return res.status(400).send({ error: 'An uploaded file with this title already exists.' });
    });
  });
};

// delete the specified map (multiple deletion not supported)
// app.delete('/events/:eventid/maps/:userid/:maptype(course|route)/:maptitle?'
const deleteMap = (req, res) => {
  logReq(req);
  const allowedToDeleteMap = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.userid));
  if (!allowedToDeleteMap) {
    logger('error')(`Error: ${req.user.email} not allowed to delete map for ${req.params.userid}.`);
    return res.status(401).send({ error: 'Not allowed to delete map for this user.' });
  }
  const {
    eventid,
    userid,
    maptype,
    maptitle,
  } = req.params;
  const title = maptitle || '';
  // check that event and user ids are appropriate format
  if (!ObjectID.isValid(eventid) || !ObjectID.isValid(userid)) {
    logger('error')('Error deleting map: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Event.findById(eventid)
    .lean() // return normal object rather than mongoose object instance
    .then((foundEvent) => { // determine what changes need to be made
      const foundRunner = foundEvent.runners.find(runner => runner.user.toString() === userid);
      if (!foundRunner) throw new Error('Runner does not exist.');
      const foundMap = foundRunner.maps.find(map => map.title === title);
      if (!foundMap) throw new Error('Map does not exist.');
      const newMapsArray = [];
      const otherMapType = (maptype === 'course') ? 'route' : 'course';
      foundRunner.maps.forEach((map) => {
        // console.log('map:', map);
        if (map.title === title) {
          // first deal with the files...
          //  1. extract filename
          const fileLocation = map[maptype];
          //  2. delete thumbnail and extract
          const thumbnailLocation = fileLocation.slice(0, -4)
            .concat('-thumb').concat(fileLocation.slice(-4));
          fs.unlink(thumbnailLocation, (delThumbErr) => {
            if (delThumbErr) throw delThumbErr;
          });
          const extractLocation = fileLocation.slice(0, -4)
            .concat('-extract').concat(fileLocation.slice(-4));
          fs.unlink(extractLocation, (delExtractErr) => {
            if (delExtractErr) throw delExtractErr;
          });
          //  3. delete overlay if it exists
          if (map.overlay && map.overlay !== '') {
            fs.unlink(map.overlay, (delOverlayErr) => {
              if (delOverlayErr) throw delOverlayErr;
            });
          }
          //  4. rename main with -deletedAt- extension
          const now = new Date();
          const deletedAt = '-deleted:'.concat((`0${now.getDate()}`).slice(-2))
            .concat((`0${(now.getMonth() + 1)}`).slice(-2))
            .concat(now.getFullYear().toString())
            .concat('@')
            .concat((`0${now.getHours()}`).slice(-2))
            .concat((`0${now.getMinutes()}`).slice(-2));
          const newFileLocation = fileLocation.slice(0, -4)
            .concat(deletedAt).concat(fileLocation.slice(-4));
          fs.rename(fileLocation, newFileLocation, (renameErr) => {
            if (renameErr) throw renameErr;
          });

          // ...then the associated record
          if (foundMap[otherMapType] && foundMap[otherMapType] !== '') {
            newMapsArray.push({ ...map, [maptype]: null, overlay: '' });
          } else {
            // console.log('*** need to delete whole map from array ***');
          }
        } else {
          newMapsArray.push(map);
        }
      });
      // console.log('newMapsArray:', newMapsArray);
      return Event.findOneAndUpdate(
        { _id: eventid, 'runners.user': userid }, // identify and reference runner
        { $set: { 'runners.$.maps': newMapsArray } }, // update map array
        { new: true }, // return updated event to provide as API response
      )
        .populate('owner', '_id displayName')
        .populate('organisedBy', '_id shortName')
        .populate('linkedTo', '_id displayName')
        .populate({
          path: 'runners.user',
          select: '_id active displayName fullName regNumber orisId profileImage visibility',
          populate: { path: 'memberOf', select: '_id shortName' },
        })
        .populate({
          path: 'runners.comments.author',
          select: '_id displayName fullName regNumber',
        })
        .select('-active -__v')
        .then((updatedEvent) => {
          logger('success')(`Map deleted from ${updatedEvent.name} by ${req.user.email}.`);
          activityLog({
            actionType: 'EVENT_MAP_DELETED',
            actionBy: req.user._id,
            event: eventid,
            eventRunner: userid,
          });
          // filter out runners that the user isn't allowed to see
          const requestorRole = req.user.role;
          const requestorId = (requestorRole === 'anonymous')
            ? null
            : req.user._id.toString();
          const requestorClubs = (requestorRole === 'anonymous')
            ? null
            : req.user.memberOf.map(club => club._id.toString());
          const selectedRunners = updatedEvent.runners.filter((runner) => {
            let canSee = false;
            if (requestorRole === 'admin' && runner.user.active) canSee = true;
            if (runner.visibility === 'public') canSee = true;
            if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
              if (runner.visibility === 'all') canSee = true;
              if (requestorId === runner.user._id.toString()) canSee = true;
              if (runner.visibility === 'club') {
                const commonClubs = runner.user.memberOf.filter((clubId) => {
                  return requestorClubs.includes(clubId.toString());
                });
                if (commonClubs.length > 0) canSee = true;
              }
            }
            return canSee;
          });
          const eventToSend = { ...updatedEvent.toObject(), runners: selectedRunners };
          return res.status(200).send(eventToSend);
        });
    })
    .catch((updateEventErr) => {
      logger('error')('Error deleting map:', updateEventErr.message);
      return res.status(400).send({ error: updateEventErr.message });
    });
};

module.exports = {
  validateMapUploadPermission,
  postMap,
  deleteMap,
};
