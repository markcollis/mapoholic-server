const { ObjectID } = require('mongodb');

const logger = require('../services/logger');
const logReq = require('./logReq');
const { dbRecordActivity } = require('../services/activityServices');
const {
  dbGetEventById,
  dbAddComment,
  dbUpdateComment,
  dbDeleteComment,
} = require('../services/eventServices');

// app.post('/events/:eventid/comments/:userid', requireAuth, Events.postComment);
// Post a new comment against the specified user's map in this event
const postComment = (req, res) => {
  logReq(req);
  const { eventid, userid } = req.params;
  const commentText = req.body.text;
  if (!commentText) {
    logger('error')('Error posting comment: no comment content.');
    return res.status(400).send({ error: 'No comment content.' });
  }
  const authorId = req.user._id.toString();
  const authorRole = req.user.role;
  if (authorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to post comments.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to post comments.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error posting comment: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error posting comment: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return dbGetEventById(eventid).then((eventToPostCommentTo) => {
    if (!eventToPostCommentTo) {
      logger('error')('Error posting comment: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToPostCommentTo.runners.length === 0)
      ? []
      : eventToPostCommentTo.runners.map(runner => runner.user._id.toString());
    if (!runnerIds.includes(userid)) {
      logger('error')('Error posting comment: runner not present.');
      return res.status(400).send({ error: 'Runner not found in event, so not possible to add comment.' });
    }
    const newComment = { author: authorId, text: commentText };
    return dbAddComment(eventid, userid, newComment).then((updatedEvent) => {
      logger('success')(`Posted comment in ${updatedEvent.name} (${updatedEvent.date}).`);
      // want to return just the relevant comments array
      const runnerToSend = updatedEvent.runners
        .find(runner => runner.user._id.toString() === userid);
      const commentsToSend = runnerToSend.comments;
      const newCommentId = commentsToSend[(commentsToSend.length - 1)]._id;
      dbRecordActivity({
        actionType: 'COMMENT_POSTED',
        actionBy: req.user._id,
        event: eventid,
        eventRunner: userid,
        comment: newCommentId,
      });
      return res.status(200).send(commentsToSend);
    });
  }).catch((err) => {
    logger('error')('Error posting comment:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// app.patch('/events/:eventid/comments/:userid/:commentid', requireAuth, Events.updateComment);
// edit the specified comment (multiple amendment not supported)
const updateComment = (req, res) => {
  logReq(req);
  const { eventid, userid, commentid } = req.params;
  const newCommentText = req.body.text;
  if (!newCommentText) {
    logger('error')('Error updating comment: no comment content.');
    return res.status(400).send({ error: 'No comment content.' });
  }
  const authorId = req.user._id.toString();
  const authorRole = req.user.role;
  if (authorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to update comments.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to update comments.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error updating comment: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error updating comment: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return dbGetEventById(eventid).then((eventToUpdateComment) => {
    if (!eventToUpdateComment) {
      logger('error')('Error updating comment: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToUpdateComment.runners.length === 0)
      ? []
      : eventToUpdateComment.runners.map(runner => runner.user._id.toString());
    if (!runnerIds.includes(userid)) {
      logger('error')('Error updating comment: runner not found.');
      return res.status(400).send({ error: 'Runner not found in event, so not possible to edit comment.' });
    }
    const selectedRunner = eventToUpdateComment.runners
      .find(runner => runner.user._id.toString() === userid);
    const selectedComment = selectedRunner.comments
      .find(comment => comment._id.toString() === commentid);
    if (!selectedComment) {
      logger('error')('Error updating comment: comment not found.');
      return res.status(400).send({ error: 'The specified comment was not found so could not be updated.' });
    }
    if (selectedComment.author._id.toString() !== authorId) {
      logger('error')('Error updating comment: you are not the author.');
      return res.status(400).send({ error: 'Only a comment\'s author can update it.' });
    }
    return dbUpdateComment(eventid, userid, commentid, newCommentText).then((updatedEvent) => {
      logger('success')(`Updated comment in ${updatedEvent.name} (${updatedEvent.date}).`);
      dbRecordActivity({
        actionType: 'COMMENT_UPDATED',
        actionBy: req.user._id,
        event: eventid,
        eventRunner: userid,
        comment: commentid,
      });
      const runnerToSend = updatedEvent.runners
        .find(runner => runner.user._id.toString() === userid);
      const commentsToSend = runnerToSend.comments;
      return res.status(200).send(commentsToSend); // don't send full event
    });
  }).catch((err) => {
    logger('error')('Error updating comment:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// app.delete('/events/:eventid/comments/:userid/:commentid', requireAuth, Events.deleteComment);
// delete the specified comment (multiple amendment not supported) - actually deletes!
const deleteComment = (req, res) => {
  logReq(req);
  const { eventid, userid, commentid } = req.params;
  const authorId = req.user._id.toString();
  const authorRole = req.user.role;
  if (authorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to delete comments.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to delete comments.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error deleting comment: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error deleting comment: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return dbGetEventById(eventid).then((eventToDeleteComment) => {
    if (!eventToDeleteComment) {
      logger('error')('Error deleting comment: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToDeleteComment.runners.length === 0)
      ? []
      : eventToDeleteComment.runners.map(runner => runner.user._id.toString());
    if (!runnerIds.includes(userid)) {
      logger('error')('Error deleting comment: runner not found.');
      return res.status(400).send({ error: 'Runner not found in event, so not possible to delete comment.' });
    }
    const selectedRunner = eventToDeleteComment.runners
      .find(runner => runner.user._id.toString() === userid);
    const selectedComment = selectedRunner.comments
      .find(comment => comment._id.toString() === commentid);
    if (!selectedComment) {
      logger('error')('Error deleting comment: comment not found.');
      return res.status(400).send({ error: 'The specified comment was not found so could not be deleted.' });
    }
    if (selectedComment.author._id.toString() !== authorId && authorRole !== 'admin') {
      logger('error')('Error deleting comment: you are not the author or an administrator.');
      return res.status(400).send({ error: 'Only a comment\'s author or an administrator can delete it.' });
    }
    return dbDeleteComment(eventid, userid, commentid).then((updatedEvent) => {
      logger('success')(`Deleted comment in ${updatedEvent.name} (${updatedEvent.date}).`);
      dbRecordActivity({
        actionType: 'COMMENT_DELETED',
        actionBy: req.user._id,
        event: eventid,
        eventRunner: userid,
        comment: commentid,
      });
      const runnerToSend = updatedEvent.runners
        .find(runner => runner.user._id.toString() === userid);
      const commentsToSend = runnerToSend.comments;
      return res.status(200).send(commentsToSend); // don't send full event
    });
  }).catch((err) => {
    logger('error')('Error deleting comment:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

module.exports = {
  postComment,
  updateComment,
  deleteComment,
};
