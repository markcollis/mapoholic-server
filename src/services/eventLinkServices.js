// Functions concerned solely or primarily with event link data (eventLink model)

const mongoose = require('mongoose');

const Event = require('../models/oevent');
const EventLink = require('../models/eventLink');

// add a new event link
const dbCreateEventLink = (fieldsToCreate) => {
  const newLink = new EventLink(fieldsToCreate);
  return newLink.save().then((createdLink) => {
    return createdLink
      .populate('includes', '_id name date')
      .execPopulate()
      .then(() => {
        return Event.updateMany({ _id: { $in: createdLink.includes } },
          { $addToSet: { linkedTo: createdLink._id } },
          { new: true }).then(() => {
          return createdLink;
        });
      });
  });
};

// get a specific event link record
const dbGetEventLinkById = (id) => {
  return EventLink.findById(id)
    .lean()
    .populate('includes', '_id name date')
    .select('-__v');
};

// get matching event link records
const dbGetEventLinks = (searchCriteria) => {
  return EventLink.find(searchCriteria)
    .lean()
    .populate('includes', '_id name date')
    .select('-__v');
};

// update an event link record
const dbUpdateEventLink = (id, fieldsToUpdate, currentIncludes) => {
  const newIncludes = fieldsToUpdate.includes.map(el => el.toString()) || [];
  const addedEventIds = newIncludes.filter(eventId => !currentIncludes.includes(eventId));
  const removedEventIds = currentIncludes.filter(eventId => !newIncludes.includes(eventId));
  // console.log('currentIncludes, newIncludes, added, removed',
  // currentIncludes, newIncludes, addedEventIds, removedEventIds);
  return EventLink.findByIdAndUpdate(id, { $set: fieldsToUpdate }, { new: true })
    .lean()
    .populate('includes', '_id name date')
    .select('-__v')
    .then((updatedEventLink) => {
      // console.log('updatedEventLink', updatedEventLink);
      // now change the eventLink references in relevant Events
      return Event.updateMany({ _id: { $in: (addedEventIds || []) } },
        { $addToSet: { linkedTo: mongoose.Types.ObjectId(updatedEventLink._id) } })
        .then(() => {
          return Event.updateMany({ _id: { $in: (removedEventIds || []) } },
            { $pull: { linkedTo: mongoose.Types.ObjectId(updatedEventLink._id) } })
            .then(() => {
              return updatedEventLink;
            });
        });
    });
};

// delete an event link record and references to it in Events
const dbDeleteEventLink = (id) => {
  return dbGetEventLinkById(id).then((eventLinkToDelete) => {
    if (!eventLinkToDelete) throw new Error('Event link could not be found.');
    return EventLink.deleteOne({ _id: id }).then((deletion) => {
      if (deletion.deletedCount === 1) {
        // should now go through and delete all references from Event.linkedTo
        return Event.updateMany({ _id: { $in: (eventLinkToDelete.includes || []) } },
          { $pull: { linkedTo: mongoose.Types.ObjectId(eventLinkToDelete._id) } });
      }
      throw new Error('Deletion error, count not equal to 1.');
    });
  });
};

module.exports = {
  dbCreateEventLink,
  dbGetEventLinkById,
  dbGetEventLinks,
  dbUpdateEventLink,
  dbDeleteEventLink,
};
