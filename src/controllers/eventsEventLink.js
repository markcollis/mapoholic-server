const { ObjectID } = require('mongodb');

const logger = require('../services/logger');
const logReq = require('./logReq');
const { dbRecordActivity } = require('../services/activityServices');
const { validateEventIds } = require('../services/validateIds');
const {
  dbCreateEventLink,
  dbGetEventLinkById,
  dbGetEventLinks,
  dbUpdateEventLink,
  dbDeleteEventLink,
} = require('../services/eventLinkServices');

// create a new event linkage between the specified events
const createEventLink = (req, res) => {
  logReq(req);
  const creatorRole = req.user.role;
  const eventLinkName = req.body.displayName;
  const eventLinkIncludes = req.body.includes;
  // simple validation checks
  if (creatorRole === 'guest') {
    logger('error')('Error creating event link: Guest accounts can not create an event link.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to create an event link.' });
  }
  if (!eventLinkName) {
    logger('error')('Error creating event link: No name provided.');
    return res.status(400).send({ error: 'You must provide a name for the event link.' });
  }
  return dbGetEventLinks({ displayName: eventLinkName }).then((existingLinks) => {
    if (existingLinks.length > 0) {
      logger('error')(`Error creating event link: The event link ${eventLinkName} already exists.`);
      return res.status(400).send({ error: `Error creating event link: The event link ${eventLinkName} already exists.` });
    }
    const fieldsToCreate = { displayName: eventLinkName };
    // includes needs special treatment: array of ObjectIDs
    // note that these will REPLACE the existing array not add to it/edit it
    const checkEventIds = (eventLinkIncludes && Array.isArray(eventLinkIncludes))
      ? validateEventIds(eventLinkIncludes)
      : Promise.resolve(false);
    return checkEventIds.then((eventIds) => {
      if (!eventIds) {
        logger('error')('Error creating event link: No valid event IDs found.');
        return res.status(400).send({ error: 'Error creating event link: No valid event IDs found' });
      }
      fieldsToCreate.includes = eventIds;
      return dbCreateEventLink(fieldsToCreate).then((savedEventLink) => {
        logger('success')(`${savedEventLink.displayName} created by ${req.user.email}.`);
        dbRecordActivity({
          actionType: 'EVENT_LINK_CREATED',
          actionBy: req.user._id,
          eventLink: savedEventLink._id,
        });
        return res.status(200).send(savedEventLink);
      });
    }).catch((err) => {
      logger('error')('Error creating event link:', err.message);
      return res.status(400).send({ error: err.message });
    });
  });
};

// retrieve a list of links between events matching specified criteria
const getEventLinks = (req, res) => {
  logReq(req);
  const eventLinkSearchCriteria = {};
  if (req.query.displayName) { // filter by name
    eventLinkSearchCriteria.displayName = { $regex: new RegExp(req.query.displayName) };
  }
  if (req.query.includes) { // filter by event (to include this specific event)
    if (ObjectID.isValid(req.query.includes)) {
      eventLinkSearchCriteria.includes = req.query.includes;
    } else {
      eventLinkSearchCriteria.includes = null;
    }
  }
  dbGetEventLinks(eventLinkSearchCriteria).then((eventLinks) => {
    logger('success')(`Returned list of ${eventLinks.length} event link(s).`);
    return res.status(200).send(eventLinks);
  }).catch((err) => {
    logger('error')('Error getting list of event links:', err.message);
    return res.status(400).send(err.message);
  });
};

// update the specified link between events (multiple amendment not supported)
const updateEventLink = (req, res) => {
  logReq(req);
  const { eventlinkid } = req.params;
  const requestorRole = req.user.role;
  if (requestorRole === 'guest') { // guests can't edit, but all standard users can
    logger('error')('Error: Guest accounts are not allowed to edit event links.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit event links.' });
  }
  if (!ObjectID.isValid(eventlinkid)) {
    logger('error')('Error updating event link: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return dbGetEventLinkById(eventlinkid).then((eventLinkToUpdate) => {
    if (!eventLinkToUpdate) {
      logger('error')('Error updating event link: no matching event found.');
      return res.status(404).send({ error: 'Event link could not be found.' });
    }
    const currentIncludes = eventLinkToUpdate.includes.map(el => el._id.toString());
    const fieldsToUpdate = {};
    if (req.body.displayName && req.body.displayName !== eventLinkToUpdate.displayName) {
      fieldsToUpdate.displayName = req.body.displayName;
    }
    const checkEventIds = (req.body.includes && Array.isArray(req.body.includes))
      ? validateEventIds(req.body.includes)
      : Promise.resolve(false);
    return checkEventIds.then((eventIds) => {
      if (eventIds) fieldsToUpdate.includes = eventIds;
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update event link error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      return dbUpdateEventLink(eventlinkid, fieldsToUpdate, currentIncludes)
        .then((updatedEventLink) => {
          logger('success')(`${updatedEventLink.displayName} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
          dbRecordActivity({
            actionType: 'EVENT_LINK_UPDATED',
            actionBy: req.user._id,
            eventLink: eventlinkid,
          });
          return res.status(200).send(updatedEventLink);
        }).catch((err) => {
          logger('error')('Error updating linked event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    });
  });
};

// delete the specified link between events (multiple amendment not supported) - actually deletes!
const deleteEventLink = (req, res) => {
  logReq(req);
  const { eventlinkid } = req.params;
  const requestorRole = req.user.role;
  if (!ObjectID.isValid(eventlinkid)) {
    logger('error')('Error deleting event link: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // only admin users are allowed to delete eventLinks
  if (requestorRole === 'admin') {
    return dbGetEventLinkById(eventlinkid).then((eventLinkToDelete) => {
      if (!eventLinkToDelete) {
        logger('error')('Error deleting event link: no matching event link found.');
        return res.status(404).send({ error: 'Event link could not be found.' });
      }
      return dbDeleteEventLink(eventlinkid).then(() => {
        logger('success')(`Successfully deleted event link ${eventLinkToDelete._id} (${eventLinkToDelete.displayName})`);
        dbRecordActivity({
          actionType: 'EVENT_LINK_DELETED',
          actionBy: req.user._id,
          eventLink: eventlinkid,
        });
        return res.status(200).send(eventLinkToDelete);
      });
    }).catch((err) => {
      logger('error')('Error deleting event link:', err.message);
      return res.status(400).send({ error: err.message });
    });
  }
  logger('error')(`Error: ${req.user.email} not allowed to delete ${eventlinkid}.`);
  return res.status(401).send({ error: 'Not allowed to delete this event link.' });
};


module.exports = {
  createEventLink,
  getEventLinks,
  updateEventLink,
  deleteEventLink,
};
