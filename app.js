/**
 *
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

var express = require("express"); // app server
var bodyParser = require("body-parser"); // parser for post requests
var fs = require("fs"); //for reading file
var AssistantV2 = require("ibm-watson/assistant/v2"); // watson sdk
var Cloudant = require("@cloudant/cloudant"); // cloudant sdk
const cors = require("cors");

const {
  IamAuthenticator,
  BearerTokenAuthenticator,
} = require("ibm-watson/auth");

var app = express();
require("./health/health")(app);

// Bootstrap application settings
app.use(express.static("./public")); // load UI from public folder
app.use(bodyParser.json());
app.use(cors());

// Create the service wrapper

let authenticator;
if (process.env.ASSISTANT_IAM_APIKEY) {
  authenticator = new IamAuthenticator({
    apikey: process.env.ASSISTANT_IAM_APIKEY,
  });
} else if (process.env.BEARER_TOKEN) {
  authenticator = new BearerTokenAuthenticator({
    bearerToken: process.env.BEARER_TOKEN,
  });
}

// Initialize Cloudant with settings from .env
var username = process.env.cloudant_username || "nodejs";
var password = process.env.cloudant_password;
var cloudant = Cloudant({ account: username, password: password });

var assistant = new AssistantV2({
  version: "2019-02-28",
  authenticator: authenticator,
  url: process.env.ASSISTANT_URL,
  disableSslVerification:
    process.env.DISABLE_SSL_VERIFICATION === "true" ? true : false,
});

// Endpoint to be call from the client side
app.post("/api/message", function (req, res) {
  let assistantId = process.env.ASSISTANT_ID || "<assistant-id>";
  if (!assistantId || assistantId === "<assistant-id>") {
    return res.json({
      output: {
        text:
          "The app has not been configured with a <b>ASSISTANT_ID</b> environment variable. Please refer to the " +
          '<a href="https://github.com/watson-developer-cloud/assistant-simple">README</a> documentation on how to set this variable. <br>' +
          "Once a workspace has been defined the intents may be imported from " +
          '<a href="https://github.com/watson-developer-cloud/assistant-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.',
      },
    });
  }

  var textIn = "";

  if (req.body.input) {
    textIn = req.body.input.text;
  }

  var payload = {
    assistantId: assistantId,
    sessionId: req.body.session_id,
    input: {
      message_type: "text",
      text: textIn,
    },
  };

  // Send the input to the assistant service
  assistant.message(payload, function (err, data) {
    if (err) {
      const status = err.code !== undefined && err.code > 0 ? err.code : 500;
      return res.status(status).json(err);
    }
    //var response = res.json(data);
    //var result = JSON.parse(response).result;
    // console.log(data.result.output);
    var local_sessionId = payload.sessionId;
    if (
      data.result.output.generic &&
      data.result.output.generic[0].text &&
      data.result.output.generic[0].text.includes("://newsapi.org")
    ) {
      let newsAPI = data.result.output.generic[0].text;
      var newsLink = "pages/" + local_sessionId + "tempnewsapiorg.html";
      fs.readFile("public/pages/newsapiorg.html", "utf8", function (
        err,
        dataum
      ) {
        if (err) {
          return console.log(err);
        }
        var result = dataum.replace(/###NEWSAPI###/g, newsAPI);
        fs.writeFile(
          "public/pages/" + local_sessionId + "tempnewsapiorg.html",
          result,
          "utf8",
          function (err) {
            if (err) return console.log(err);
          }
        );
      });
      data.result.output.generic[0].text = newsLink;
    }
    return res.json(updateMessage(payload, data));
  });
});

app.get("/api/newsfeedhtml", function (req, res) {
  fs.readFile("public/pages/newsapiorg.html", "utf8", function (err, dataum) {
    if (err) {
      return console.log(err);
    }
    return res.send(dataum);
  });
});

app.get("/api/session", function (req, res) {
  assistant.createSession(
    {
      assistantId: process.env.ASSISTANT_ID || "{assistant_id}",
    },
    function (error, response) {
      if (error) {
        return res.send(error);
      } else {
        if (fs.existsSync("public/pages/tempnewsapiorg.html")) {
          fs.unlink("public/pages/tempnewsapiorg.html", function (err) {
            if (err) throw err;
            // if no error, file has been deleted successfully
            console.log("File deleted!");
          });
        }
        return res.send(response);
      }
    }
  );
});

// initialize wrapper for Cloudant
// If CLOUDANT_DBNAME is set, store it in credential variable
// andthen VCAP_SERVICES (username/pw) parse to JSON  log in using VCAP_SERVICES
//by parsing it to JSON
var record_log = false;
if (process.env.CLOUDANT_DB_NAME) {
  record_log = true; //variable for saving records to Cloudant later
  //requires the cloudant_lib.js file to initialize database
  const Cloudant_lib = require("./cloudant_lib");
  var cloudant = new Cloudant_lib({
    cloudantUrl: process.env.CLOUDANT_URL,
    cloudantDbName: process.env.CLOUDANT_DB_NAME,
    initializeDatabase: true,
  });
}
/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */

function updateMessage(input, response) {
  // var output = response.output;
  //Check for suggestions

  if (
    response.result.output.generic &&
    response.result.output.generic.length > 0
  ) {
    var genericArray = [];
    for (var i = 0; i < response.result.output.generic.length; i++) {
      if (response.result.output.generic[i].suggestions) {
        //console.log(response.result.output.generic[i].suggestions);
        if (response.result.output.generic[i].suggestions.length > 1) {
          genericArray = genericArray.concat(
            cloudant.suggestion_pick(response.result.output.generic[i])
          );
        } else {
          if (
            response.result.output.generic[i].suggestions[0].output &&
            response.result.output.generic[i].suggestions[0].output.generic
          ) {
            genericArray.concat(
              response.result.output.generic[i].suggestions[0].output.generic
            );
          }
        }
      }
    }
    console.log("genericArray", genericArray);
    if (genericArray.length > 0) {
      response.result.output.generic = genericArray;
    }
  }
  // Compares the external request with output action
  if (
    response.result.output.generic &&
    response.result.output.generic[0].text &&
    response.result.output.generic[0].text.startsWith("I don't know the answer")
  ) {
    if (record_log) {
      cloudant.record_log(input, response, function (err, msg) {
        if (err) {
          console.log(err);
        } else {
          // console.log(msg);
        }
      });
    }
  }
  //Save log to Cloudant if variable is set to true

  return response;
}

module.exports = app;
