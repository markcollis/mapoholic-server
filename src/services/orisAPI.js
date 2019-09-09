// Functions that exploit the ORIS API (oris.orientacnisporty.cz/API)
const fetch = require('node-fetch');
const logger = require('./logger');

const ORIS_API_GETCLUB = 'https://oris.orientacnisporty.cz/API/?format=json&method=getClub';
const ORIS_API_GETEVENT = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEvent';
const ORIS_API_GETEVENTENTRIES = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEventEntries';
const ORIS_API_GETEVENTRESULTS = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEventResults';
const ORIS_API_GETUSEREVENTENTRIES = 'https://oris.orientacnisporty.cz/API/?format=json&method=getUserEventEntries';
const ORIS_API_GETUSER = 'https://oris.orientacnisporty.cz/API/?format=json&method=getUser';

// helper function to get ORIS club data - returns a Promise
const getOrisClubData = (clubAbbr) => {
  return fetch(`${ORIS_API_GETCLUB}&id=${clubAbbr}`)
    .then(response => response.json())
    .then(json => json.Data)
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}. Create operation may proceed.`);
      // don't send an HTTP error response, the club can still be created without ORIS input
    });
};

// helper function to get ORIS event data - returns a Promise
const getOrisEventData = (orisEventId) => {
  return fetch(`${ORIS_API_GETEVENT}&id=${orisEventId}`)
    .then(response => response.json())
    .then(json => json.Data);
};

// helper function to get ORIS event entries data - returns a Promise
const getOrisEventEntryData = (orisEventId) => {
  return fetch(`${ORIS_API_GETEVENTENTRIES}&eventid=${orisEventId}`)
    .then(response => response.json())
    .then(json => json.Data);
};

// helper function to get ORIS event results data - returns a Promise
const getOrisEventResultsData = (orisEventId) => {
  return fetch(`${ORIS_API_GETEVENTRESULTS}&eventid=${orisEventId}`)
    .then(response => response.json())
    .then(json => json.Data);
};

// helper function to get a list of events entered by a user - returns a Promise
const getOrisEventList = (orisUserId, dateFilter) => {
  return fetch(`${ORIS_API_GETUSEREVENTENTRIES}&userid=${orisUserId}${dateFilter}`)
    .then(response => response.json())
    .then(json => json.Data);
};

// helper function to get ORIS user id - returns a Promise
const getOrisUserId = (regNumber) => {
  return fetch(`${ORIS_API_GETUSER}&rgnum=${regNumber}`)
    .then(response => response.json())
    .then(json => json.Data.ID)
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}. Rest of update may proceed.`);
      // don't send an HTTP error response, the rest of the update may be fine
    });
};


module.exports = {
  getOrisClubData,
  getOrisEventData,
  getOrisEventEntryData,
  getOrisEventResultsData,
  getOrisEventList,
  getOrisUserId,
};
