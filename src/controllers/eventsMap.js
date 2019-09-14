const { ObjectID } = require('mongodb');
const fs = require('fs');
const path = require('path');

const logger = require('../services/logger');
const logReq = require('./logReq');
const { dbRecordActivity } = require('../services/activityServices');
const { getQRData, calculateDistance } = require('../services/parseQR');
const { createRouteOverlay } = require('../services/createRouteOverlay');
const { createThumbnailAndExtract } = require('../services/createThumbnailAndExtract');
const { dbGetEventById, dbUpdateEvent } = require('../services/eventServices');

// confirm that the user has permission to upload a map (do not process image if rejected)
const validateMapUploadPermission = (req, res, next) => {
  const allowedToUploadMap = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.userid));
  if (!allowedToUploadMap) {
    logger('error')(`Error: ${req.user.email} not allowed to upload map for ${req.params.userid}.`);
    return res.status(401).send({ error: 'Not allowed to upload map for this user.' });
  }
  return next();
};

// upload a scanned map to the specified event for user :userid
// :maptype is either course or route
// :maptitle is the label to use for each part of multi-part maps (default: '')
// app.post('/events/:eventid/maps/:userid/:maptype(course|route)/:maptitle'
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
    if (mkdirErr && mkdirErr.code !== 'EEXIST') {
      logger('error')(`Error creating directory images/maps/${eventid}: ${mkdirErr.message}`);
      return res.status(400).send({ error: 'Filesystem error.' });
    }
    // check that there isn't already a file with the same name (i.e. maptitle has been used
    // before in the context of this map, even if it is not it's current 'title')
    return fs.access(newFileLocation, (accessFileErr) => {
      if (accessFileErr && accessFileErr.code === 'ENOENT') {
        // i.e. if we get an error that the file doesn't exist, go ahead and rename
        return fs.rename(req.file.path, newFileLocation, (renameErr) => {
          if (renameErr) {
            logger('error')(`Error renaming ${req.file.path} to ${newFileLocation}: ${renameErr.message}`);
            return res.status(400).send({ error: 'Filesystem error.' });
          }
          return fs.readFile(newFileLocation, (readFileErr, data) => {
            if (readFileErr) {
              logger('error')(`Error reading ${newFileLocation}: ${readFileErr.message}`);
              return res.status(400).send({ error: 'Filesystem error.' });
            }
            // Try to create overlay:
            // will return null if files don't exist, are different sizes, etc.
            // for now, don't worry about confirming through API that overlay has been created
            const filenameBase = newFileLocation.slice(0, newFileLocation.lastIndexOf('-'));
            const routeFilename = filenameBase.concat('-route.jpg');
            const courseFilename = filenameBase.concat('-course.jpg');
            const overlayThreshold = 63;
            // returns a Promise resolving to an overlay (new PNG object) or null if unsuccessful
            return createRouteOverlay(routeFilename, courseFilename, overlayThreshold)
              .then((newOverlay) => {
                const overlayFilename = (newOverlay) ? filenameBase.concat('-overlay.png') : null;
                if (newOverlay) {
                  newOverlay
                    .pack()
                    .pipe(fs.createWriteStream(overlayFilename));
                }
                // create thumbnail and extract
                createThumbnailAndExtract(newFileLocation);
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
                return dbGetEventById(eventid).then((eventToUpdate) => {
                  const fieldsToUpdate = {};
                  const maptypeUpdated = maptype.concat('Updated');
                  const timeUpdated = new Date().getTime().toString();
                  let runnerExists = false;
                  const newRunners = eventToUpdate.runners.map((runner) => {
                    if (runner.user._id.toString() === userid) {
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
                  return dbUpdateEvent(eventid, fieldsToUpdate).then((updatedEvent) => {
                    // console.log('updatedEvent:', updatedEvent);
                    logger('success')(`Map added to ${updatedEvent.name} by ${req.user.email}.`);
                    dbRecordActivity({
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
                    const eventToSend = { ...updatedEvent, runners: selectedRunners };
                    return res.status(200).send(eventToSend);
                  }).catch((updateEventErr) => {
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
  return dbGetEventById(eventid)
    .then((foundEvent) => { // determine what changes need to be made
      const foundRunner = foundEvent.runners.find(runner => runner.user._id.toString() === userid);
      if (!foundRunner) throw new Error('Runner does not exist.');
      const foundMap = foundRunner.maps.find(map => map.title === title);
      if (!foundMap) throw new Error('Map does not exist.');
      const newMapsArray = [];
      const otherMapType = (maptype === 'course') ? 'route' : 'course';
      foundRunner.maps.forEach((map) => {
        // console.log('map:', map);
        if (map.title === title) {
          //  1. extract filename
          const fileLocationElements = map[maptype].split('/').slice(-4);
          const fileLocation = path.join(...fileLocationElements);
          //  2. delete thumbnail and extract
          const thumbnailLocation = fileLocation.slice(0, -4)
            .concat('-thumb').concat(fileLocation.slice(-4));
          fs.unlink(thumbnailLocation, (delThumbErr) => {
            if (delThumbErr) {
              if (delThumbErr.code === 'ENOENT') {
                logger('warning')(`Can not delete thumbnail at ${thumbnailLocation} as it doesn't exist`);
              // It didn't exist so can't be deleted
              } else {
                logger('error')(`Error deleting thumbnail at ${thumbnailLocation}: ${delThumbErr.message}`);
                // log error but continue with deletion from the database,
                // issues with local filesystem will need to be reviewed separately
              }
            }
          });
          const extractLocation = fileLocation.slice(0, -4)
            .concat('-extract').concat(fileLocation.slice(-4));
          fs.unlink(extractLocation, (delExtractErr) => {
            if (delExtractErr) {
              if (delExtractErr.code === 'ENOENT') {
                logger('warning')(`Can not delete extract at ${extractLocation} as it doesn't exist`);
              // It didn't exist so can't be deleted
              } else {
                logger('error')(`Error deleting extract at ${extractLocation}: ${delExtractErr.message}`);
                // log error but continue with deletion from the database,
                // issues with local filesystem will need to be reviewed separately
              }
            }
          });
          //  3. delete overlay if it exists
          if (map.overlay) {
            fs.unlink(map.overlay, (delOverlayErr) => {
              if (delOverlayErr) {
                if (delOverlayErr.code === 'ENOENT') {
                  logger('warning')(`Can not delete overlay at ${map.overlay} as it doesn't exist`);
                // It didn't exist so can't be deleted
                } else {
                  logger('error')(`Error deleting overlay at ${map.overlay}: ${delOverlayErr.message}`);
                  // log error but continue with deletion from the database,
                  // issues with local filesystem will need to be reviewed separately
                }
              }
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
            if (renameErr) {
              logger('error')(`Error renaming ${fileLocation} to ${newFileLocation}: ${renameErr.message}`);
              // log error but continue with deletion from the database,
              // issues with local filesystem will need to be reviewed separately
            }
          });

          // 5. delete the associated database record
          if (foundMap[otherMapType] && foundMap[otherMapType] !== '') {
            newMapsArray.push({ ...map, [maptype]: null, overlay: '' });
          } else {
            // do nothing, need to delete whole map from array
          }
        } else {
          newMapsArray.push(map);
        }
      });
      const newRunners = foundEvent.runners.map((runner) => {
        if (runner.user._id.toString() === userid) {
          return { ...runner, maps: newMapsArray };
        }
        return runner;
      });
      const fieldsToUpdate = { runners: newRunners };
      return dbUpdateEvent(eventid, fieldsToUpdate).then((updatedEvent) => {
        logger('success')(`Map deleted from ${updatedEvent.name} by ${req.user.email}.`);
        dbRecordActivity({
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
        const eventToSend = { ...updatedEvent, runners: selectedRunners };
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
