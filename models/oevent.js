// Note: 'oevent' has been used in place of the more natural 'event'
// to avoid any potential confusion with event handlers
const mongoose = require('mongoose');
const validator = require('validator');

// define model for map information (to be embedded in event)
const mapSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  visibility: {
    type: String,
    required: true,
    enum: [
      'public', //  visible to anyone even if not logged in
      'all', //     visible to all logged in users (including guests)
      'club', //    visible to logged in users that are members of the same club
      'private', // only visible to the user concerned (and admin users)
    ],
    default: 'all',
  },
  course: {
    title: { type: String },
    length: { type: Number }, // km
    climb: { type: Number }, // m
    controls: { type: Number },
  },
  performance: { // all optional, enables detailed info to be captured if the user wants to
    time: { type: Number }, // seconds, can be presented to user as hh:mm:ss or mmm:ss
    place: { type: Number }, // more useful for stats although e.g. 3rd= can't be represented
    fieldSize: { type: Number },
    winningTime: { type: Number },
    distanceRun: { type: Number }, // km - from GPS but assume manually entered to start with
  },
  tags: [{ type: String }],
  images: { // reference to file in /uploads/map/map_id/
    numberOfParts: { type: Number, required: true, default: 1 },
    thumbnail: { type: String, required: true }, // thumbnail.jpg (auto-generated from part 1)
    parts: [{
      partTitle: { type: String },
      main: { type: String, required: true }, //      main.jpg
      blank: { type: String }, //                     blank.jpg (optional if main has route)
      geo: { // information to be extracted from QR jpg on upload; only centre/corners set manually
        isGeocoded: { type: Boolean, required: true, default: false },
        mapCentre: {
          lat: { type: Number, min: -90, max: 90 },
          long: { type: Number, min: -180, max: 180 },
        },
        mapCorners: {
          sw: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
          nw: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
          ne: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
          se: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
        },
        imageCorners: {
          sw: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
          nw: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
          ne: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
          se: {
            lat: { type: Number, min: -90, max: 90 },
            long: { type: Number, min: -180, max: 180 },
          },
        },
        locationSizePixels: {
          x: { type: Number, min: 0 },
          y: { type: Number, min: 0 },
          width: { type: Number, min: 0 },
          height: { type: Number, min: 0 },
        },
      },
    }],
  },
  comments: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    // need to think about whether a link to _profile_ is more relevant
    text: { type: String, required: true },
    postedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// define model for event (and embedded map) information
const oeventSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  date: { type: Date, required: true },
  name: { type: String, required: true, unique: true },
  organisedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'club' }],
  linkedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'linkedevent' }],
  mapName: { type: String },
  nearbyTown: { type: String },
  country: { type: String, validate: value => validator.isISO31661Alpha3(value) },
  categories: [{ type: String }], // discipline labels - to be defined in front end
  // then set up an enum here to match (including translations)
  // e.g. Sprint, Middle, Long, Relay, Score, Night, MTBO, SkiO, TrailO, Training
  website: { type: String, validate: value => validator.isURL(value) },
  results: { type: String, validate: value => validator.isURL(value) },
  maps: [mapSchema],
  lastModified: { type: Date },
}, { timestamps: true });

// create model class
const ModelClass = mongoose.model('oevent', oeventSchema);

// export model
module.exports = ModelClass;
