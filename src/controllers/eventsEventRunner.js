const { ObjectID } = require('mongodb');
const fetch = require('node-fetch');
const Event = require('../models/oevent');
const logger = require('../services/logger');
const logReq = require('./logReq');
const activityLog = require('../services/activityLog');

// add current user as a runner at the specified event
const addEventRunner = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  const requestorClubs = req.user.memberOf.map(club => club._id.toString());
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error adding runner to event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to identify existing runners
  return Event.findById(eventid).then((eventToAddRunnerTo) => {
    if (!eventToAddRunnerTo) {
      logger('error')('Error adding runner to event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToAddRunnerTo.runners.length === 0)
      ? []
      : eventToAddRunnerTo.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (runnerIds.includes(requestorId)) {
      logger('error')('Error adding runner to event: runner already present.');
      return res.status(400).send({ error: 'Runner already present in event. Use PATCH to update.' });
    }
    const fieldsToCreateRunner = { user: requestorId };
    const validFields = [ // all except maps and comments which have their own POST routes
      'visibility',
      // course details from ORIS getEvent Data.Classes.Class_nnnn.
      'courseTitle', // ORIS Name
      'courseLength', // ORIS Distance (km)
      'courseClimb', // ORIS Climbing (m)
      'courseControls', // ORIS Controls
      'fullResults', // [] allowed to submit manually, front end might not support initially though
      // following can be obtained if ORIS hosts results via getEventResults&eventid&classid
      'time', // hhh:mm Data.Result_nnnnn.Time [UserID=orisId]
      'place', // Data.Result_nnnn.Place
      'timeBehind', // Data.Result_nnnn.Loss
      'fieldSize', // can work out from ORIS result set length
      'distanceRun', // actual km - from GPS (or some manual measurement of route length)
      'tags', // []
    ];
    Object.keys(req.body).forEach((key) => {
      if (validFields.includes(key)) {
        fieldsToCreateRunner[key] = req.body[key];
      }
    });
    // console.log('fieldsToCreateRunner:', fieldsToCreateRunner);
    return Event.findByIdAndUpdate(eventid, { $addToSet: { runners: fieldsToCreateRunner } },
      { new: true })
      .populate('owner', '_id displayName')
      .populate('organisedBy', '_id shortName')
      .populate('linkedTo', '_id displayName')
      .populate({
        path: 'runners.user',
        select: '_id displayName fullName regNumber orisId profileImage visibility',
        populate: { path: 'memberOf', select: '_id shortName' },
      })
      .populate({
        path: 'runners.comments.author',
        select: '_id displayName fullName regNumber',
      })
      .select('-active -__v')
      .then((updatedEvent) => {
        const filteredEvent = updatedEvent;
        if (updatedEvent.runners.length > 0) {
          const selectedRunners = updatedEvent.runners.map((runner) => {
            let canSee = false;
            if (requestorRole === 'admin') canSee = true;
            if (runner.visibility === 'public') canSee = true;
            if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
              if (runner.visibility === 'all') canSee = true;
              if (requestorId === runner.user._id.toString()) canSee = true;
              if (runner.visibility === 'club') {
                const commonClubs = runner.user.memberOf.filter((clubId) => {
                  return requestorClubs.includes(clubId.toString());
                });
                // console.log('commonClubs', commonClubs);
                if (commonClubs.length > 0) canSee = true;
              }
            }
            if (canSee) return runner;
            return false;
          });
          filteredEvent.runners = selectedRunners.filter(runner => runner);
        }
        logger('success')(`Added ${req.user.email} as runner to ${updatedEvent.name} (${updatedEvent.date}).`);
        activityLog({
          actionType: 'EVENT_RUNNER_ADDED',
          actionBy: req.user._id,
          event: eventid,
          eventRunner: req.user._id,
        });
        return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error adding runner to event:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error adding runner to event:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// app.post('/events/:eventid/oris', requireAuth, Events.orisAddEventRunner);
// add current user as a new runner using ORIS data
const orisAddEventRunner = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  const requestorOrisId = req.user.orisId;
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!requestorOrisId || requestorOrisId === '') {
    logger('error')('Error: You do not have an ORIS user ID.');
    return res.status(400).send({ error: 'User does not have an ORIS ID so cannot be added as a runner.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error adding runner to event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to identify event and runners
  return Event.findById(eventid).then((eventToAddRunnerTo) => {
    if (!eventToAddRunnerTo) {
      logger('error')('Error updating event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    if (!eventToAddRunnerTo.orisId || eventToAddRunnerTo.orisId === '') {
      logger('error')('Error adding runner: event does not have ORIS ID.');
      return res.status(400).send({ error: 'Event does not have ORIS ID.' });
    }
    const runnerIds = (eventToAddRunnerTo.runners.length === 0)
      ? []
      : eventToAddRunnerTo.runners.map(runner => runner.user.toString());
    if (runnerIds.includes(requestorId)) {
      logger('error')('Error adding runner to event: runner already present.');
      return res.status(400).send({ error: 'Runner already present in event. Use PATCH to update.' });
    }
    const ORIS_API_GETEVENT = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEvent';
    const ORIS_API_GETEVENTENTRIES = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEventEntries';
    const ORIS_API_GETEVENTRESULTS = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEventResults';
    const getOrisEventData = fetch(`${ORIS_API_GETEVENT}&id=${eventToAddRunnerTo.orisId}`)
      .then(response => response.json());
    const getOrisEntryData = fetch(`${ORIS_API_GETEVENTENTRIES}&eventid=${eventToAddRunnerTo.orisId}`)
      .then(response => response.json());
    const getOrisResultsData = fetch(`${ORIS_API_GETEVENTRESULTS}&eventid=${eventToAddRunnerTo.orisId}`)
      .then(response => response.json());
    return Promise.all([getOrisEventData, getOrisEntryData, getOrisResultsData])
      .then(([orisEventData, orisEntryData, orisResultsData]) => {
        // console.log('ORIS requests made');
        const runnerEntryData = orisEntryData.Data[Object.keys(orisEntryData.Data)
          .filter((entryKey) => {
            return orisEntryData.Data[entryKey].UserID === requestorOrisId;
          })];
        let runnerClassData = null;
        if (runnerEntryData && runnerEntryData.ClassID) {
          runnerClassData = orisEventData.Data.Classes[`Class_${runnerEntryData.ClassID}`];
        }
        // console.log('runnerClassData:', runnerClassData);
        let classResultsData = null;
        let runnerResultsData = null;
        if (orisResultsData && Object.keys(orisResultsData.Data).length > 0) {
          classResultsData = Object.keys(orisResultsData.Data)
            .filter((resultKey) => {
              if (orisResultsData.Data[resultKey] && runnerEntryData) {
                return orisResultsData.Data[resultKey].ClassID === runnerEntryData.ClassID;
              }
              return false;
            })
            .map(resultKey => orisResultsData.Data[resultKey]);
          runnerResultsData = classResultsData.find((result) => {
            return result.UserID === requestorOrisId;
          });
        }
        // console.log('classResultsData:', classResultsData);
        // console.log('runnerResultsData:', runnerResultsData);
        req.body = { visibility: req.user.visibility };
        if (runnerClassData) {
          req.body.courseTitle = runnerClassData.Name;
          req.body.courseLength = runnerClassData.Distance;
          req.body.courseClimb = runnerClassData.Climbing;
          req.body.courseControls = runnerClassData.Controls;
        }
        if (runnerResultsData) {
          req.body.time = runnerResultsData.Time;
          req.body.place = runnerResultsData.Place;
          req.body.timeBehind = runnerResultsData.Loss;
          req.body.fieldSize = classResultsData.length;
          req.body.fullResults = classResultsData.map((runner) => {
            return {
              place: runner.Place,
              sort: runner.Sort,
              name: runner.Name,
              regNumber: runner.RegNo,
              clubShort: runner.RegNo.slice(0, 3),
              club: runner.ClubNameResults,
              time: runner.Time,
              loss: runner.Loss,
            };
          });
        }
        // console.log('req.body:', req.body);
        return addEventRunner(req, res);
      })
      .catch((orisErr) => {
        logger('error')(`ORIS API error: ${orisErr.message}.`);
        return res.status(400).send({ error: orisErr.message });
      });
  });
};

// update the specified runner and map data (multiple amendment not supported)
const updateEventRunner = (req, res) => {
  logReq(req);
  const { eventid, userid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error updating runner at event: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error updating runner at event: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToUpdateRunnerAt) => {
    if (!eventToUpdateRunnerAt) {
      logger('error')('Error updating runner at event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToUpdateRunnerAt.runners.length === 0)
      ? []
      : eventToUpdateRunnerAt.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (!runnerIds.includes(userid)) {
      logger('error')('Error updating runner at event: runner not present.');
      return res.status(400).send({ error: 'Runner not present in event. Use POST to add.' });
    }
    const allowedToUpdate = ((requestorRole === 'admin')
    || (requestorRole === 'standard' && requestorId === userid));
    if (allowedToUpdate) {
      const fieldsToUpdateRunner = {};
      const validFields = [ // all except comments which have their own PATCH route
        'visibility',
        'courseTitle', // ORIS Name
        'courseLength', // ORIS Distance (km)
        'courseClimb', // ORIS Climbing (m)
        'courseControls', // ORIS Controls
        'fullResults', // [] will replace entire set of results recorded
        'time', // hhh:mm Data.Result_nnnnn.Time [UserID=orisId]
        'place', // Data.Result_nnnn.Place
        'timeBehind', // Data.Result_nnnn.Loss
        'fieldSize', // can work out from ORIS result set length
        'distanceRun', // actual km - from GPS (or some manual measurement of route length)
        'tags', // [] will replace entire set of tags
        'maps', // [] *** important *** will replace the entire map record, request must be complete
      ];
      Object.keys(req.body).forEach((key) => {
        if (validFields.includes(key)) {
          fieldsToUpdateRunner[key] = req.body[key];
        }
      });
      // console.log('fieldsToUpdateRunner:', fieldsToUpdateRunner);
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdateRunner).length;
      // console.log('fields to be updated:', numberOfFieldsToUpdate);
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update runner at event error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      const setObject = Object.keys(fieldsToUpdateRunner).reduce((acc, cur) => {
        return Object.assign(acc, { [`runners.$.${cur}`]: fieldsToUpdateRunner[cur] });
      }, {});
      // console.log('setObject:', setObject);
      return Event.findOneAndUpdate(
        { _id: eventid, 'runners.user': userid },
        { $set: setObject },
        // { $pull: { runners: { user: userid } } },  // to delete instead of update - use below
        { new: true },
      )
        .populate('owner', '_id displayName')
        .populate('organisedBy', '_id shortName')
        .populate('linkedTo', '_id displayName')
        .populate({
          path: 'runners.user',
          select: '_id displayName fullName regNumber orisId profileImage visibility',
          populate: { path: 'memberOf', select: '_id shortName' },
        })
        .populate({
          path: 'runners.comments.author',
          select: '_id displayName fullName regNumber',
        })
        .select('-active -__v')
        .then((updatedEvent) => {
          logger('success')(`Updated ${req.user.email} in ${updatedEvent.name} (${updatedEvent.date}) (${numberOfFieldsToUpdate} field(s)).`);
          activityLog({
            actionType: 'EVENT_RUNNER_UPDATED',
            actionBy: req.user._id,
            event: eventid,
            eventRunner: userid,
          });
          return res.status(200).send(updatedEvent);
        })
        .catch((err) => {
          logger('error')('Error updating runner at event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to update runner ${userid}.`);
    return res.status(401).send({ error: 'Not allowed to update this runner.' });
  }).catch((err) => {
    logger('error')('Error updating runner at event:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// app.delete('/events/:eventid/maps/:userid', requireAuth, Events.deleteEventRunner);
// delete the specified runner and map data (multiple amedment not supported) - actually deletes!
const deleteEventRunner = (req, res) => {
  logReq(req);
  const { eventid, userid } = req.params;
  const requestorId = req.user._id.toString();
  const requestorRole = req.user.role;
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to delete runners.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to delete runners.' });
  }
  const isAdmin = (requestorRole === 'admin');
  const isRunner = (requestorRole === 'standard' && requestorId === userid);
  const canDelete = isAdmin || isRunner;
  if (!canDelete) {
    logger('error')('Error: You are not allowed to delete this runner.');
    return res.status(401).send({ error: 'Not allowed to delete this runner.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error deleting runner: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error deleting runner: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToDeleteRunner) => {
    if (!eventToDeleteRunner) {
      logger('error')('Error deleting runner: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const selectedRunner = eventToDeleteRunner.runners
      .find(runner => runner.user.toString() === userid);
    if (!selectedRunner) {
      logger('error')('Error deleting runner: runner not found.');
      return res.status(400).send({ error: 'Runner not found in event, so can not be deleted.' });
    }
    // all checks done, can now delete
    return Event.findOneAndUpdate(
      { _id: eventid },
      { $pull: { runners: { user: userid } } },
      { new: true },
    )
      .populate('owner', '_id displayName')
      .populate('organisedBy', '_id shortName')
      .populate('linkedTo', '_id displayName')
      .populate({
        path: 'runners.user',
        select: '_id displayName fullName regNumber orisId profileImage visibility',
        populate: { path: 'memberOf', select: '_id shortName' },
      })
      .populate({
        path: 'runners.comments.author',
        select: '_id displayName fullName regNumber',
      })
      .select('-active -__v')
      .then((updatedEvent) => {
        logger('success')(`Deleted runner from ${updatedEvent.name} (${updatedEvent.date}).`);
        activityLog({
          actionType: 'EVENT_RUNNER_DELETED',
          actionBy: req.user._id,
          event: eventid,
          eventRunner: userid,
        });
        return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error deleting runner:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error deleting runner:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

module.exports = {
  addEventRunner,
  orisAddEventRunner,
  updateEventRunner,
  deleteEventRunner,
};
