// Functions concerned solely or primarily with event data (oevent model)
const mongoose = require('mongoose');

const Event = require('../models/oevent');
const EventLink = require('../models/eventLink');
const { prefixImagePath } = require('../services/prefixImagePath');

// prefix all image paths in an event record
const prefixEventImagePaths = (rawEvent) => {
  return {
    ...rawEvent,
    runners: rawEvent.runners.map((runner) => {
      return {
        ...runner,
        user: (runner.user.profileImage)
          ? {
            ...runner.user,
            profileImage: prefixImagePath(runner.user.profileImage),
          }
          : { ...runner.user },
        comments: runner.comments.map((comment) => {
          return {
            ...comment,
            author: {
              ...comment.author,
              profileImage: prefixImagePath(comment.author.profileImage),
            },
          };
        }),
        maps: runner.maps.map((eachMap) => {
          return {
            ...eachMap,
            course: prefixImagePath(eachMap.course),
            route: prefixImagePath(eachMap.route),
            overlay: prefixImagePath(eachMap.overlay),
          };
        }),
      };
    }),
  };
};

// add a new event
const dbCreateEvent = (fieldsToCreate) => {
  const newEvent = new Event(fieldsToCreate);
  return newEvent.save().then((savedEvent) => {
    return savedEvent
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
      .execPopulate()
      .then((populatedEvent) => {
        const { _doc: eventObject } = populatedEvent;
        return prefixEventImagePaths(eventObject);
      })
      .then((createdEvent) => {
        // add event reference to eventLinks if there are any
        if (fieldsToCreate.linkedTo) {
          const eventLinksToUpdate = fieldsToCreate.linkedTo.map(el => el.toString());
          EventLink.updateMany({ _id: { $in: (eventLinksToUpdate) } },
            { $addToSet: { includes: createdEvent._id } })
            .then(() => {
              return createdEvent;
            });
        }
        return createdEvent;
      });
  }).catch((err) => {
    if (err.message.slice(0, 6) === 'E11000') {
      const duplicate = err.message.split('"')[1];
      throw new Error(`Duplicate value ${duplicate}.`);
    }
    throw new Error(`Error creating event: ${err.message}`);
  });
};

// get a specific event record
const dbGetEventById = (id) => {
  return Event.findOne({ _id: id, active: true }) // only active records should be returned
    .lean()
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
      select: '_id displayName fullName active profileImage',
    })
    .select('-active -__v')
    .then(foundEvent => prefixEventImagePaths(foundEvent));
};

// get matching event records
const dbGetEvents = (searchCriteria) => {
  return Event.find(searchCriteria)
    .lean()
    .populate('owner', '_id displayName')
    .populate('organisedBy', '_id shortName')
    .populate('linkedTo', '_id displayName')
    .populate('runners.user', '_id displayName memberOf active')
    .select('-active -__v')
    .then(foundEvents => foundEvents.map((rawEvent) => {
      return {
        ...rawEvent,
        runners: rawEvent.runners.map((runner) => {
          return {
            ...runner,
            maps: runner.maps.map((eachMap) => {
              return {
                ...eachMap,
                course: prefixImagePath(eachMap.course),
                route: prefixImagePath(eachMap.route),
                overlay: prefixImagePath(eachMap.overlay),
              };
            }),
          };
        }),
      };
    }));
};

// update an event record
const dbUpdateEvent = (id, fieldsToUpdate, currentEventLinks = []) => {
  const newEventLinks = (fieldsToUpdate.linkedTo)
    ? fieldsToUpdate.linkedTo.map(linkId => linkId.toString())
    : [];
  const addedEventLinkIds = newEventLinks
    .filter(eventId => !currentEventLinks.includes(eventId));
  const removedEventLinkIds = currentEventLinks
    .filter(eventId => !newEventLinks.includes(eventId));
  return Event.findByIdAndUpdate(id, { $set: fieldsToUpdate }, { new: true })
    .lean()
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
      select: '_id displayName fullName profileImage regNumber',
    })
    .select('-__v')
    .then(populatedEvent => prefixEventImagePaths(populatedEvent))
    .then((updatedEvent) => {
      // now change the Event references in relevant EventLinks
      if (addedEventLinkIds.length > 0 || removedEventLinkIds.length > 0) {
        return EventLink.updateMany({ _id: { $in: (addedEventLinkIds || []) } },
          { $addToSet: { includes: updatedEvent._id } })
          .then(() => {
            return EventLink.updateMany({ _id: { $in: (removedEventLinkIds || []) } },
              { $pull: { includes: updatedEvent._id } }).then(() => {
              return updatedEvent;
            });
          });
      }
      return updatedEvent;
    });
};

// delete an event record and references to it in EventLinks
const dbDeleteEvent = (id) => {
  return dbGetEventById(id).then((eventToDelete) => {
    if (!eventToDelete) throw new Error('Event could not be found.');
    const now = new Date();
    const deletedAt = 'deleted:'.concat((`0${now.getDate()}`).slice(-2))
      .concat((`0${(now.getMonth() + 1)}`).slice(-2))
      .concat(now.getFullYear().toString())
      .concat('@')
      .concat((`0${now.getHours()}`).slice(-2))
      .concat((`0${now.getMinutes()}`).slice(-2));
    const newName = `${eventToDelete.name} ${deletedAt}`;
    const newOrisId = (eventToDelete.orisId)
      ? `${eventToDelete.orisId} ${deletedAt}`
      : null;
    const fieldsToUpdate = {
      active: false, // no longer visible through API
      name: newName, // with deleted timestamp
      orisId: newOrisId, // with deleted timestamp
      linkedTo: [], // remove cross-references
    };
    const currentEventLinks = eventToDelete.linkedTo
      .map(eventLink => eventLink._id.toString());
    return dbUpdateEvent(id, fieldsToUpdate, currentEventLinks)
      .then((deletedEvent) => {
        // delete any references in EventLinks
        return EventLink.updateMany({}, { $pull: { includes: mongoose.Types.ObjectId(id) } })
          .then(() => {
            return deletedEvent;
          });
      });
  });
};

const dbAddRunner = (eventId, runnerDetails) => {
  return Event.findByIdAndUpdate(eventId, { $addToSet: { runners: runnerDetails } }, { new: true })
    .lean()
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
    .then(populatedEvent => prefixEventImagePaths(populatedEvent));
};

const dbUpdateRunner = (eventId, runnerUserId, runnerDetails) => {
  const setObject = Object.keys(runnerDetails).reduce((acc, cur) => {
    return Object.assign(acc, { [`runners.$.${cur}`]: runnerDetails[cur] });
  }, {});
  return Event.findOneAndUpdate(
    { _id: eventId, 'runners.user': runnerUserId },
    { $set: setObject },
    { new: true },
  )
    .lean()
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
    .then(populatedEvent => prefixEventImagePaths(populatedEvent));
};

const dbDeleteRunner = (eventId, runnerUserId) => {
  return Event.findOneAndUpdate(
    { _id: eventId },
    { $pull: { runners: { user: mongoose.Types.ObjectId(runnerUserId) } } },
    { new: true },
  )
    .lean()
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
    .then(populatedEvent => prefixEventImagePaths(populatedEvent));
};

const dbAddComment = (eventId, runnerId, comment) => {
  return Event.findOneAndUpdate(
    { _id: eventId, 'runners.user': runnerId },
    { $push: { 'runners.$.comments': comment } },
    { new: true },
  )
    .lean()
    .populate({
      path: 'runners.user',
      select: '_id',
    })
    .populate({
      path: 'runners.comments.author',
      select: '_id displayName fullName profileImage regNumber',
    })
    .then(populatedEvent => prefixEventImagePaths(populatedEvent));
};

const dbUpdateComment = (eventId, runnerId, commentId, newText) => {
  const now = new Date();
  return Event.findOneAndUpdate(
    { _id: eventId, runners: { $elemMatch: { user: runnerId, 'comments._id': commentId } } },
    {
      $set: {
        'runners.$[outer].comments.$[inner].text': newText,
        'runners.$[outer].comments.$[inner].updatedAt': now,
      },
    },
    {
      arrayFilters: [{ 'outer.user': runnerId }, { 'inner._id': commentId }],
      new: true,
    },
  )
    .lean()
    .populate({
      path: 'runners.user',
      select: '_id',
    })
    .populate({
      path: 'runners.comments.author',
      select: '_id displayName fullName profileImage regNumber',
    })
    .then(populatedEvent => prefixEventImagePaths(populatedEvent));
};

const dbDeleteComment = (eventId, runnerId, commentId) => {
  return Event.findOneAndUpdate(
    { _id: eventId, 'runners.user': runnerId },
    { $pull: { 'runners.$.comments': { _id: commentId } } },
    { new: true },
  )
    .lean()
    .populate({
      path: 'runners.user',
      select: '_id',
    })
    .populate({
      path: 'runners.comments.author',
      select: '_id displayName fullName profileImage regNumber',
    })
    .then(populatedEvent => prefixEventImagePaths(populatedEvent));
};

module.exports = {
  dbCreateEvent,
  dbGetEventById,
  dbGetEvents,
  dbUpdateEvent,
  dbDeleteEvent,
  dbAddRunner,
  dbUpdateRunner,
  dbDeleteRunner,
  dbAddComment,
  dbUpdateComment,
  dbDeleteComment,
};
