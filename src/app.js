'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('node-uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');
const config = require("../app.json");

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = config.env.APIAI_ACCESS_TOKEN.value;
const APIAI_LANG = config.env.APIAI_LANG.value || 'en';
const FB_VERIFY_TOKEN = config.env.FB_VERIFY_TOKEN.value;
const FB_PAGE_ACCESS_TOKEN = config.env.FB_PAGE_ACCESS_TOKEN.value;

const apiAiService = apiai(APIAI_ACCESS_TOKEN, {language: APIAI_LANG, requestSource: "fb"});
const sessionIds = new Map();

/**
 * Robinhood API: https://github.com/sanko/Robinhood/
 */

function formatNumber(num) {
  num = Number(num);
  if (num < 1000000) {
    return `$${num.toFixed(2)}`;
  }
  
  num /= 1000000;
  if (num < 1000) {
    return `$${num.toFixed(2)}M`;
  }

  num /= 1000;
  return `$${num.toFixed(2)}B`;
}

function sendError(sender, errorStr) {
  console.log('sending error message');
  sendFBMessage(
      sender,
      {text: errorStr + '. \nAvailable commands `@quote FB`, `@info TSLA`, `@earnings GOOGL`'});
}

function getQuote(sender, symbol) {
  if (!symbol) {
    return sendError(sender, 'unknown symbol');
  }

  let uri = `https://api.robinhood.com/quotes/${symbol.toUpperCase()}/`;
  request(uri, (error, response, body) => {
    if (error || response.statusCode != 200) {
      return sendError(sender, 'internal network error to query information');
    }
    let data = JSON.parse(body);
    let retVal = `You will have to pay ${formatNumber(data.last_trade_price)} for 1 share of ${data.symbol.toUpperCase()}`;
    sendFBMessageBig(sender, retVal);
  });
}

function getInfo(sender, symbol) {
  if (!symbol) {
    return sendError(sender, 'unknown symbol');
  }

  let uri = `https://api.robinhood.com/fundamentals/${symbol.toUpperCase()}/`;
  request(uri, (error, response, body) => {
    if (error || response.statusCode != 200) {
      return sendError(sender, 'internal network error to query information');
    }

    let data = JSON.parse(body);
    let retVal = 'Symbol: ' + symbol.toUpperCase()
               + '\nOpen: ' + formatNumber(data.open)
               + '\nLow: ' + formatNumber(data.low)
               + '\nHigh: ' + formatNumber(data.high)
               + '\nLow 52 Weeks: ' + formatNumber(data.low_52_weeks)
               + '\nHigh 52 Weeks: ' + formatNumber(data.high_52_weeks)
               + '\nP/E Ratio: ' + data.pe_ratio + '%'
               + '\nMarket Cap: ' + formatNumber(data.market_cap)
               + '\nDescription: ' + data.description;
    sendFBMessageBig(sender, retVal);
  });
}

function processEvent(event) {
  var sender = event.sender.id.toString();

  if (!(event.message && event.message.text) && !(event.postback && event.postback.payload)) {
    sendFBMessage(sender, {text: 'Unknown event'});
    return;
  }

  // Handle a text message from this sender
  let text = event.message ? event.message.text : event.postback.payload;
  console.log("**********Text: ", text);
  let tokens = text.split(' ');
  if (tokens.length < 2) {
    return sendError(sender, 'insufficient input');
  }

  switch (tokens[0]) {
    case '@quote':
      getQuote(sender, tokens[1]);
      break;
    case '@info':
      getInfo(sender, tokens[1]);
      break;
    default:
      sendError(sender, `unknown command ${tokens[0]}.`);
  }
}

/*
function processEvent(event) {
  var sender = event.sender.id.toString();
  console.log('Yo yo');

  if ((event.message && event.message.text) || (event.postback && event.postback.payload)) {
    var text = event.message ? event.message.text : event.postback.payload;
    // Handle a text message from this sender

    if (!sessionIds.has(sender)) {
      sessionIds.set(sender, uuid.v4());
    }

    console.log("Text: ", text);

    let apiaiRequest = apiAiService.textRequest(text,
      {
        sessionId: sessionIds.get(sender),
        originalRequest: {
          data: event,
          source: "facebook"
        }
      });

    apiaiRequest.on('response', (response) => {
      if (isDefined(response.result)) {
        let responseText = response.result.fulfillment.speech;
        let responseData = response.result.fulfillment.data;
        let action = response.result.action;

        if (isDefined(responseData) && isDefined(responseData.facebook)) {
          if (!Array.isArray(responseData.facebook)) {
            try {
              console.log('Response as formatted message');
              sendFBMessage(sender, responseData.facebook);
            } catch (err) {
              sendFBMessage(sender, {text: err.message});
            }
          } else {
            async.eachSeries(responseData.facebook, (facebookMessage, callback) => {
              try {
                if (facebookMessage.sender_action) {
                  console.log('Response as sender action');
                  sendFBSenderAction(sender, facebookMessage.sender_action, callback);
                }
                else {
                  console.log('Response as formatted message');
                  sendFBMessage(sender, facebookMessage, callback);
                }
              } catch (err) {
                sendFBMessage(sender, {text: err.message}, callback);
              }
            });
          }
        } else if (isDefined(responseText)) {
          console.log('Response as text message');
          // facebook API limit for text length is 320,
          // so we must split message if needed
          var splittedText = splitResponse(responseText);

          async.eachSeries(splittedText, (textPart, callback) => {
            sendFBMessage(sender, {text: textPart}, callback);
          });
        }

      }
    });

    apiaiRequest.on('error', (error) => console.error(error));
    apiaiRequest.end();
  }
}
*/

function splitResponse(str) {
  if (str.length <= 320) {
    return [str];
  }

  return chunkString(str, 300);
}

function chunkString(s, len) {
  var curr = len, prev = 0;

  var output = [];

  while (s[curr]) {
    if (s[curr++] == ' ') {
      output.push(s.substring(prev, curr));
      prev = curr;
      curr += len;
    }
    else {
      var currReverse = curr;
      do {
        if (s.substring(currReverse - 1, currReverse) == ' ') {
          output.push(s.substring(prev, currReverse));
          prev = currReverse;
          curr = currReverse + len;
          break;
        }
        currReverse--;
      } while (currReverse > prev)
    }
  }
  output.push(s.substr(prev));
  return output;
}

function sendFBMessageBig(sender, messageData, callback) {
  var splittedText = splitResponse(messageData);
  async.eachSeries(splittedText, (textPart, callback) => {
    sendFBMessage(sender, {text: textPart}, callback);
  });
}

function sendFBMessage(sender, messageData, callback) {
  console.log('sending message to ', sender, messageData);
  request({
    url: 'https://graph.facebook.com/v2.6/me/messages',
    qs: {access_token: FB_PAGE_ACCESS_TOKEN},
    method: 'POST',
    json: {
      recipient: {id: sender},
      message: messageData
    }
  }, (error, response, body) => {
    if (error) {
      console.log('Error sending message: ', error);
    } else if (response.body.error) {
      console.log('Error: ', response.body.error);
    }

    console.log('sent message to ', sender, messageData);
    if (callback) {
      callback();
    }
  });
}

function sendFBSenderAction(sender, action, callback) {
  setTimeout(() => {
    request({
      url: 'https://graph.facebook.com/v2.6/me/messages',
      qs: {access_token: FB_PAGE_ACCESS_TOKEN},
      method: 'POST',
      json: {
        recipient: {id: sender},
        sender_action: action
      }
    }, (error, response, body) => {
      if (error) {
        console.log('Error sending action: ', error);
      } else if (response.body.error) {
        console.log('Error: ', response.body.error);
      }
      if (callback) {
        callback();
      }
    });
  }, 1000);
}

function doSubscribeRequest() {
  request({
      method: 'POST',
      uri: "https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=" + FB_PAGE_ACCESS_TOKEN
    },
    (error, response, body) => {
      if (error) {
        console.error('Error while subscription: ', error);
      } else {
        console.log('Subscription result: ', response.body);
      }
    });
}

function isDefined(obj) {
  if (typeof obj == 'undefined') {
    return false;
  }

  if (!obj) {
    return false;
  }

  return obj != null;
}

const app = express();

app.use(bodyParser.text({type: 'application/json'}));

app.get('/marketstalker/webhook/', (req, res) => {
  if (req.query['hub.verify_token'] == FB_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);

    setTimeout(() => {
      doSubscribeRequest();
    }, 3000);
  } else {
    res.send('Error, wrong validation token');
  }
});

app.post('/marketstalker/webhook/', (req, res) => {
  try {
    var data = JSONbig.parse(req.body);

    if (data.entry) {
      let entries = data.entry;
      entries.forEach((entry) => {
        let messaging_events = entry.messaging;
        if (messaging_events) {
          messaging_events.forEach((event) => {
            if (event.message && !event.message.is_echo ||
              event.postback && event.postback.payload) {
              processEvent(event);
            }
          });
        }
      });
    }

    return res.status(200).json({
      status: "ok"
    });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      error: err
    });
  }
});

app.get('/marketstalker/yesteapea/', (req, res) => {
  return res.status(200).json({
    name1: 'Sai Teja Pratap',
    name2: 'Saif Hasan',
  });
});

app.listen(REST_PORT, () => {
  console.log('Rest service ready on port ' + REST_PORT);
});

doSubscribeRequest();
