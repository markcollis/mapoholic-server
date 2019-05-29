const { ObjectID } = require('mongodb');
const mongoose = require('mongoose');
const Event = require('../models/oevent');
const LinkedEvent = require('../models/linkedEvent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const {
  validateEventIds,
} = require('./validateIds');

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
  return LinkedEvent.findOne({ displayName: eventLinkName }).then((existingLinkedEvent) => {
    if (existingLinkedEvent) {
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
      const newLinkedEvent = new LinkedEvent(fieldsToCreate);
      return newLinkedEvent.save((err, savedLinkedEvent) => {
        savedLinkedEvent
          .populate('includes', '_id name date')
          .execPopulate()
          .then(() => {
            // now add the linkedEvent reference to the events concerned
            Event.updateMany({ _id: { $in: eventIds } },
              { $addToSet: { linkedTo: savedLinkedEvent._id } },
              { new: true })
              .then(() => {
                logger('success')(`${savedLinkedEvent.displayName} created by ${req.user.email}.`);
                return res.status(200).send(savedLinkedEvent);
              });
          });
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
  LinkedEvent.find(eventLinkSearchCriteria)
    .populate('includes', '_id name date')
    .select('-__v')
    .then((linkedEvents) => {
      logger('success')(`Returned list of ${linkedEvents.length} event link(s).`);
      return res.status(200).send(linkedEvents);
    })
    .catch((err) => {
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
  return LinkedEvent.findById(eventlinkid).then((linkedEventToUpdate) => {
    if (!linkedEventToUpdate) {
      logger('error')('Error updating event link: no matching event found.');
      return res.status(404).send({ error: 'Event link could not be found.' });
    }
    const currentIncludes = linkedEventToUpdate.includes.map(el => el.toString());
    // console.log('includes before editing:', currentIncludes);
    const fieldsToUpdate = {};
    if (req.body.displayName && req.body.displayName !== linkedEventToUpdate.displayName) {
      fieldsToUpdate.displayName = req.body.displayName;
    }
    const checkEventIds = (req.body.includes && Array.isArray(req.body.includes))
      ? validateEventIds(req.body.includes)
      : Promise.resolve(false);
    return checkEventIds.then((eventIds) => {
      if (eventIds) fieldsToUpdate.includes = eventIds;
      const newIncludes = (eventIds)
        ? eventIds.map(el => el.toString())
        : linkedEventToUpdate.includes;
      // console.log('eventIds to be new includes:', newIncludes);
      const addedEventIds = newIncludes.filter(eventId => !currentIncludes.includes(eventId));
      const removedEventIds = currentIncludes.filter(eventId => !newIncludes.includes(eventId));
      // console.log('added, removed:', addedEventIds, removedEventIds);
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update event link error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      return LinkedEvent.findByIdAndUpdate(eventlinkid, { $set: fieldsToUpdate }, { new: true })
        .populate('includes', '_id name date')
        .select('-__v')
        .then((updatedLinkedEvent) => {
          // now change the linkedEvent references in relevant Events
          Event.updateMany({ _id: { $in: (addedEventIds || []) } },
            { $addToSet: { linkedTo: mongoose.Types.ObjectId(updatedLinkedEvent._id) } })
            .then(() => {
              Event.updateMany({ _id: { $in: (removedEventIds || []) } },
                { $pull: { linkedTo: mongoose.Types.ObjectId(updatedLinkedEvent._id) } })
                .then(() => {
                  logger('success')(`${updatedLinkedEvent.displayName} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
                  return res.status(200).send(updatedLinkedEvent);
                });
            });
        })
        .catch((err) => {
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
  // only admin users are allowed to delete linkedEvents
  if (requestorRole === 'admin') {
    return LinkedEvent.findById(eventlinkid).then((linkedEventToDelete) => {
      if (!linkedEventToDelete) {
        logger('error')('Error deleting event link: no matching event link found.');
        return res.status(404).send({ error: 'Event link could not be found.' });
      }
      return LinkedEvent.deleteOne({ _id: eventlinkid }).then((deletion) => {
        if (deletion.deletedCount === 1) {
          // should now go through and delete all references from Event.linkedTo
          return Event.updateMany({ _id: { $in: (linkedEventToDelete.includes || []) } },
            { $pull: { linkedTo: mongoose.Types.ObjectId(linkedEventToDelete._id) } })
            .then(() => {
              logger('success')(`Successfully deleted event link ${linkedEventToDelete._id} (${linkedEventToDelete.displayName})`);
              return res.status(200).send(linkedEventToDelete);
            });
        }
        logger('error')('Error deleting event link: deletedCount not 1');
        return res.status(400).send({ error: 'Error deleting event link: deletedCount not 1' });
      })
        .catch((err) => {
          logger('error')('Error deleting event link:', err.message);
          return res.status(400).send({ error: err.message });
        });
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
