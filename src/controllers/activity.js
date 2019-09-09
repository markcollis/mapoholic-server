const { ObjectID } = require('mongodb');

const logReq = require('./logReq');
const logger = require('../services/logger');
const { getActivityList } = require('../services/activityServices');

// retrieve a list of recent activity matching specified criteria
const getActivityLog = (req, res) => {
  logReq(req);
  const activitySearchCriteria = {};
  const requestor = req.user;
  const listLength = req.query.number;
  // support filtering using query strings
  const validFilters = ['actionType', 'actionBy', 'club', 'comment', 'event', 'eventRunner', 'linkedEvent', 'user'];
  Object.keys(req.query).forEach((key) => {
    if (validFilters.includes(key)) {
      if (key === 'actionType') {
        activitySearchCriteria.actionType = req.query.actionType;
      } else if (ObjectID.isValid(req.query[key])) {
        // needs additional check to avoid ObjectID cast error
        activitySearchCriteria[key] = req.query[key];
      } else {
        activitySearchCriteria[key] = null;
      }
    }
  });
  getActivityList(activitySearchCriteria, requestor, listLength)
    .then((activityQueryResults) => {
      logger('success')(`Returned list of ${activityQueryResults.length} activities.`);
      return res.status(200).send(activityQueryResults);
    })
    .catch((err) => {
      logger('error')('Error getting activity log:', err.message);
      return res.status(400).send(err.message);
    });
};

module.exports = {
  getActivityLog,
};
