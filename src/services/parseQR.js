const { Parser } = require('binary-parser');

const Ignore = new Parser()
  .uint16be('length')
  .skip(function getLength() {
    return this.length - 2;
  });

const SOI = new Parser();
const EOI = new Parser();

const APP0JFIF = new Parser()
  .string('identifier', { zeroTerminated: true, formatter: string => 'J'.concat(string) })
  .uint8('jfifVersionMajor')
  .uint8('jfifVersionMinor')
  .uint8('jfifPixelDensityUnits')
  .uint16be('jfifHorizontalPixelDensity')
  .uint16be('jfifVerticalPixelDensity')
  .uint8('jfifHorizontalPixels')
  .uint8('jfifVerticalPixels')
  .buffer('jfifThumbnail', {
    length: function jfifThumbnailLength() {
      return 3 * this.jfifHorizontalPixels * this.jfifVerticalPixels;
    },
  });

const QRIgnore = new Parser()
  .uint32le('QRIgnoreLength')
  .skip(function getLength() {
    return this.QRIgnoreLength;
  });

const QR1 = new Parser()
  .uint32le('Length')
  .array('QRVersion', {
    type: 'uint8',
    length: 4,
    formatter: function formatVersion(array) {
      return array.join('.');
    },
  });

const formatCornerPositions = (array) => {
  const corners = {
    sw: {
      lat: array[1] / 3600000,
      long: array[0] / 3600000,
    },
    nw: {
      lat: array[3] / 3600000,
      long: array[2] / 3600000,
    },
    ne: {
      lat: array[5] / 3600000,
      long: array[4] / 3600000,
    },
    se: {
      lat: array[7] / 3600000,
      long: array[6] / 3600000,
    },
  };
  return corners;
};

const QR2 = new Parser()
  .uint32le('Length')
  .array('MapCornerPositions', {
    type: 'uint32le',
    length: 8,
    formatter: formatCornerPositions,
  });

const QR3 = new Parser()
  .uint32le('Length')
  .array('ImageCornerPositions', {
    type: 'uint32le',
    length: 8,
    formatter: formatCornerPositions,
  });

const QR4 = new Parser()
  .uint32le('length')
  .array('MapLocationAndSizeInPixels', {
    type: 'uint16le',
    length: 4,
    formatter: function formatMLS(array) {
      return {
        x: array[0],
        y: array[1],
        width: array[2],
        height: array[3],
      };
    },
  });

const QR7TimeStamp = new Parser()
  .array('timestamp', {
    type: 'uint32le',
    length: 2,
    formatter: (array) => {
      const newHigh = (array[1] > 1073741823) ? array[1] - 1073741824 : array[1];
      const combinedMilliSeconds = (newHigh * 429496.7296) + (array[0] / 10000);
      const correctedEpoch = combinedMilliSeconds - 62135596800000;
      // console.log('QR7time', new Date(correctedEpoch));
      return new Date(correctedEpoch);
    },
  });

const QR7TimeDelta = new Parser()
  .uint16le('timeDeltaSeconds', { formatter: value => value / 1000 });

// three attributes (position, time, altitude)
const QR7WaypointNoHR = new Parser()
  .uint32le('long', {
    formatter: (value) => {
      // console.log('QR7WaypointNoHR long', value / 3600000);
      return value / 3600000;
    },
  })
  .uint32le('lat', {
    formatter: (value) => {
      // console.log('QR7WaypointNoHR lat', value / 3600000);
      return value / 3600000;
    },
  })
  .uint8('timeType')
  .choice('time', {
    tag: 'timeType',
    choices: {
      0: QR7TimeStamp,
    },
    defaultChoice: QR7TimeDelta,
  })
  .uint16le('altitude');

const QR7SegmentNoHR = new Parser()
  .uint32le('waypointCount')
  // , {
  //   formatter: (value) => {
  //     console.log('waypoint count', value);
  //     return value;
  //   },
  // })
  .array('waypoints', {
    type: QR7WaypointNoHR,
    length: 'waypointCount',
  });

const QR7SegmentsNoHR = new Parser()
  .uint32le('segmentCount')
  .array('segments', {
    type: QR7SegmentNoHR,
    length: 'segmentCount',
  });

// assumes all four attributes (position, time, HR, altitude)
const QR7Waypoint = new Parser()
  .uint32le('long', {
    formatter: (value) => {
      // console.log('QR7Waypoint long', value / 3600000);
      return value / 3600000;
    },
  })
  .uint32le('lat', {
    formatter: (value) => {
      // console.log('QR7Waypoint lat', value / 3600000);
      return value / 3600000;
    },
  })
  .uint8('timeType')
  .choice('time', {
    tag: 'timeType',
    choices: {
      0: QR7TimeStamp,
    },
    defaultChoice: QR7TimeDelta,
  })
  .uint8('heartRate')
  .uint16le('altitude');

const QR7Segment = new Parser()
  .uint32le('waypointCount')
  // , {
  //   formatter: (value) => {
  //     console.log('waypoint count', value);
  //     return value;
  //   },
  // })
  .array('waypoints', {
    type: QR7Waypoint,
    length: 'waypointCount',
  });

const QR7Segments = new Parser()
  .uint32le('segmentCount')
  .array('segments', {
    type: QR7Segment,
    length: 'segmentCount',
  });

const QR7 = new Parser()
  .uint32le('length')
  .uint16le('attributes')
  .uint16le('extraWaypointAttributesLength') // assume 0 for now
  .choice('attributes', {
    tag: 'QR7SegmentType',
    choices: {
      11: QR7SegmentsNoHR,
    },
    defaultChoice: QR7Segments,
  });

const QR8Handle = new Parser()
  .array('transformationMatrix', {
    type: 'doublele',
    length: 9,
  })
  .uint32le('segmentIndex')
  .doublele('value')
  .doublele('locationX')
  .doublele('locationY')
  .uint16le('type');

const QR8 = new Parser()
  .uint32le('length')
  .uint32le('handleCount')
  .array('handles', {
    type: QR8Handle,
    length: 'handleCount',
  });

const QR9 = new Parser()
  .uint32le('length')
  .uint32le('projectionOriginLong', { formatter: value => value / 3600000 })
  .uint32le('projectionOriginLat', { formatter: value => value / 3600000 });

const QR10Lap = new Parser()
  .array('time', {
    type: 'uint32le',
    length: 2,
    formatter: (array) => {
      const newHigh = (array[1] > 1073741823) ? array[1] - 1073741824 : array[1];
      // let newHigh = array[1];
      // if (newHigh > 1073741823) newHigh -= 1073741824;
      const combinedMilliSeconds = (newHigh * 429496.7296) + (array[0] / 10000);
      const correctedEpoch = combinedMilliSeconds - 62135596800000;
      return new Date(correctedEpoch);
      // return {
      //   low: array[0],
      //   high: array[1],
      //   combined: combinedMilliSeconds,
      //   corrected: correctedEpoch,
      //   date: new Date(correctedEpoch),
      // };
    },
  })
  .uint8('type');

const QR10 = new Parser()
  .uint32le('length')
  .uint32le('lapCount')
  .array('laps', {
    type: QR10Lap,
    length: 'lapCount',
  });

const QR11 = new Parser()
  .uint32le('length')
  .uint16le('nameLength')
  .string('name', { length: 'nameLength' })
  .uint16le('clubLength')
  .string('club', { length: 'clubLength' })
  .uint32le('id')
  .uint16le('descriptionLength')
  .string('description', { length: 'descriptionLength' });

const QR6Section = new Parser()
  .uint8('qR6Tag')
  .choice('qR6Section', {
    tag: 'qR6Tag',
    choices: {
      7: QR7, // Route
      8: QR8, // Handles
      9: QR9, // ProjectionOrigin
      10: QR10, // Laps
      11: QR11, // SessionInfo
      // 12: QR12, // MapReadingInfo - don't have an example to test
    },
    defaultChoice: QRIgnore,
  });

const QR6 = new Parser()
  .uint32le('QR6Length')
  .array('qR6Sections', {
    type: QR6Section,
    readUntil: function check(item, buffer) {
      return buffer.readInt8(0) === -1;
    },
  });

const QR5Section = new Parser()
  .uint8('qR5Tag')
  .choice('qR5Section', {
    tag: 'qR5Tag',
    choices: {
      6: QR6, // Session
    },
    defaultChoice: QRIgnore,
  });

const QR5 = new Parser()
  .uint32le('length')
  .uint32le('SessionCount')
  .array('qR5Sections', {
    type: QR5Section,
    length: 'SessionCount',
  });

const QRSection = new Parser()
  .uint8('qRTag')
  .choice('qRSection', {
    tag: 'qRTag',
    choices: {
      1: QR1,
      2: QR2,
      3: QR3,
      4: QR4,
      5: QR5,
    },
    defaultChoice: QRIgnore,
  });

const APP0QR = new Parser()
  .string('identifier', { length: 9, formatter: string => 'Q'.concat(string) })
  .array('sections', {
    type: QRSection,
    readUntil: function check(item, buffer) {
      return buffer.readInt8(0) === -1;
    },
  });

const APP0 = new Parser()
  .uint16be('length')
  .uint8('identifierFirst')
  .choice('type', {
    tag: 'identifierFirst',
    choices: {
      0x4a: APP0JFIF,
      0x51: APP0QR,
    },
  });

const Segment = new Parser()
  .uint16be('marker')
  .choice('segment', {
    tag: 'marker',
    choices: {
      0xffc0: Ignore, // SOF0 65472
      0xffc4: Ignore, // DHT 65476
      0xffd8: SOI, // 65496
      0xffd9: EOI, // 65497
      0xffda: Ignore, // SOS 65498
      0xffdb: Ignore, // DQT 65499
      0xffe0: APP0, // 65504
      0xffe1: Ignore, // EXIF 65505
    },
    defaultChoice: Ignore,
  });

const quickRouteParser = new Parser()
  .array('segments', {
    type: Segment,
    readUntil: function checkSegment(segment) {
      return segment.marker === 0xffda; // i.e. stop when we reach the actual image
    },
  });

const getQRData = (buffer) => {
  if (buffer.readInt8(0) !== -1) { // not a JPG
    return { isGeocoded: false };
  }
  let rawData;
  try {
    rawData = quickRouteParser.parse(buffer);
  } catch (err) {
    // console.log('Error parsing QuickRoute data:', err);
    return { isGeocoded: false };
  }
  // console.log('rawData:', JSON.stringify(rawData, null, 2));
  const toReturn = { isGeocoded: false };
  if (rawData.segments && rawData.segments.length > 0) {
    const extractQR = rawData.segments.filter((segment) => {
      return (segment.marker === 65504 && segment.segment.type.identifier === 'QuickRoute');
    });
    if (extractQR.length === 1) {
      const sections = extractQR[0].segment.type.sections.map((section) => {
        return {
          type: section.qRTag,
          content: section.qRSection,
        };
      });
      toReturn.isGeocoded = true;
      sections.forEach((section) => {
        if (section.content.QRVersion) {
          toReturn.version = section.content.QRVersion;
        }
        if (section.content.ImageCornerPositions) {
          toReturn.imageCorners = section.content.ImageCornerPositions;
        }
        if (section.content.MapCornerPositions) {
          const mCPs = section.content.MapCornerPositions;
          toReturn.mapCorners = mCPs;
          toReturn.mapCentre = {
            lat: (mCPs.sw.lat + mCPs.nw.lat + mCPs.ne.lat + mCPs.se.lat) / 4,
            long: (mCPs.sw.long + mCPs.nw.long + mCPs.ne.long + mCPs.se.long) / 4,
          };
        }
        if (section.content.MapLocationAndSizeInPixels) {
          toReturn.locationSizePixels = section.content.MapLocationAndSizeInPixels;
        }
        if (section.content.SessionCount) {
          toReturn.sessions = {
            sessionCount: section.content.SessionCount,
          };
          toReturn.sessions.sessionData = section.content.qR5Sections.map((qR5Section) => {
            const session = {};
            qR5Section.qR5Section.qR6Sections.forEach((qR6Section) => {
              switch (qR6Section.qR6Tag) {
                case 7:
                  session.route = qR6Section.qR6Section.segments.map((segment) => {
                    return {
                      waypointCount: segment.waypoints.length,
                      waypoints: segment.waypoints.map((waypoint) => {
                        return [waypoint.lat, waypoint.long];
                      }),
                    };
                  });
                  break;
                case 8:
                  session.handles = qR6Section.qR6Section.handles;
                  break;
                case 9:
                  session.projectionOrigin = [
                    qR6Section.qR6Section.projectionOriginLat,
                    qR6Section.qR6Section.projectionOriginLong,
                  ];
                  break;
                case 10:
                  session.laps = qR6Section.qR6Section.laps.map((lap) => {
                    const lapTypes = {
                      0: 'start',
                      1: 'intermediate',
                      2: 'end',
                    };
                    return {
                      time: lap.time,
                      type: lapTypes[lap.type],
                    };
                  });
                  break;
                case 11:
                  session.sessionInfo = {
                    name: qR6Section.qR6Section.name,
                    club: qR6Section.qR6Section.club,
                    description: qR6Section.qR6Section.description,
                  };
                  break;
                default:
              }
            });
            if (session.route && session.handles) {
              const matrices = session.handles.map((handle) => {
                return [handle.transformationMatrix, handle.segmentIndex, handle.value];
              });
              const segmentLengths = session.route.map(segment => segment.waypointCount);
              session.matrix = { matrices, segmentLengths };
            }
            return session;
          });
        }
      });
    }
  }
  // console.log('toReturn:', JSON.stringify(toReturn, null, 2));
  return toReturn;
};

const toRadians = (degrees) => {
  return degrees * Math.PI / 180;
};

// simple approximation of distance for points that are close together
const calculateDistance = (a, b) => { // (a, b are lat, long coordinates)
  if (!a[0] || !a[1] || !b[0] || !b[1]) return undefined;
  if (Math.abs(a[0]) > 90 || Math.abs(b[0]) > 90
    || Math.abs(a[1]) > 180 || Math.abs(b[1]) > 180) return undefined;
  const earthRadius = 6371000; // metres
  const aLat = toRadians(a[0]);
  const aLong = toRadians(a[1]);
  const bLat = toRadians(b[0]);
  const bLong = toRadians(b[1]);
  const x = (aLong - bLong) * Math.cos((aLat + bLat) / 2);
  const y = aLat - bLat;
  const d = earthRadius * Math.sqrt(x * x + y * y);
  return d;
};

// projects point (lat, long) relative to origin (lat, long) transformed by matrix
const projectPoint = (origin, point, matrix) => {
  if (!origin[0] || !origin[1] || !point[0] || !point[1]) return undefined;
  if (Math.abs(origin[0]) > 90 || Math.abs(point[0]) > 90
    || Math.abs(origin[1]) > 180 || Math.abs(point[1]) > 180) return undefined;
  if (matrix && matrix.length && matrix.length !== 9) return undefined;
  // 3x3 matrix listed as three rows concatenated - default is identity
  const transMatrix = matrix || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const earthRadius = 6371000; // metres
  const originLat = toRadians(origin[0]);
  const originLong = toRadians(origin[1]);
  const pointLat = toRadians(point[0]);
  const pointLong = toRadians(point[1]);
  // project relative to origin
  const newX = earthRadius * Math.cos(pointLat) * Math.sin(pointLong - originLong);
  const newY = earthRadius * (Math.cos(originLat) * Math.sin(pointLat)
    - Math.sin(originLat) * Math.cos(pointLat) * Math.cos(pointLong - originLong));
  // now transform (newX, newY, 1) by transMatrix
  const transX = transMatrix[0] * newX + transMatrix[1] * newY + transMatrix[2];
  const transY = transMatrix[3] * newX + transMatrix[4] * newY + transMatrix[5];
  return [transX, transY];
};


module.exports = {
  quickRouteParser,
  getQRData,
  calculateDistance,
  projectPoint,
};
