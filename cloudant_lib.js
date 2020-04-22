const Cloudant = require("cloudant");
const async = require("async");
const nano = require("nano-seconds");

function CloudandStorage(options) {
  const self = this;
  const cloudant = Cloudant({
    url: options.cloudantUrl,
    plugin: "retry",
    retryAttempts: 10,
    retryTimeout: 500,
  }).db;
  let cloudantDb;

  if (!options.initializeDatabase) {
    cloudantDb = cloudant.use(options.cloudantDbName);
  } else {
    const prepareDbTasks = [];

    // create the db
    prepareDbTasks.push((callback) => {
      console.log("Creating database...");
      cloudant.create(options.cloudantDbName, (err) => {
        if (err && err.statusCode === 412) {
          console.log("Database already exists");
          callback(null);
        } else if (err) {
          callback(err);
        } else {
          callback(null);
        }
      });
    });

    // use it
    prepareDbTasks.push((callback) => {
      console.log("Setting current database to", options.cloudantDbName);
      cloudantDb = cloudant.use(options.cloudantDbName);
      callback(null);
    });

    // create design documents
    const designDocuments = require("./cloudant-designs.json");
    designDocuments.docs.forEach((doc) => {
      prepareDbTasks.push((callback) => {
        console.log("Creating", doc._id);
        cloudantDb.insert(doc, (err) => {
          if (err && err.statusCode === 409) {
            console.log("Design", doc._id, "already exists");
            callback(null);
          } else if (err) {
            callback(err);
          } else {
            callback(null);
          }
        });
      });
    });

    async.waterfall(prepareDbTasks, (err) => {
      if (err) {
        console.log("Error in database preparation", err);
      } else {
        console.log("Database is ready.");
      }
    });
  }

  // add a new document
  self.insert = function (doc, insertCallback /* err, doc*/) {
    cloudantDb.insert(doc, (err, body) => {
      insertCallback(err, body);
    });
  };

  // get a document
  self.get = function (docId, callback /* err, media*/) {
    cloudantDb.get(
      docId,
      {
        include_docs: true,
      },
      callback
    );
  };

  self.record_log = function (input, response, callback) {
    var log_data = {};
    log_data["_id"] = nano.toString();
    log_data["session_id"] = input.sessionId;
    log_data["timestamp"] = new Date();
    log_data["assistant_id"] = input.assistantId;
    log_data["input"] = input.input;
    var responses = [];
    response.result.output.generic.forEach(function (gen) {
      self.get_response_output(responses, gen);
    });
    log_data["output"] = responses;
    if (response.result.output.intents.length) {
      var intent = response.result.output.intents[0];
      log_data["intent"] = intent.intent;
      log_data["intent_confidence"] = intent.confidence;
    }
    if (response.result.output.entities.length) {
      var entity = response.result.output.entities[0];
      log_data["entity"] = entity.entity;
      log_data["entity_value"] = entity.value;
    }
    self.insert(log_data, callback);
  };

  self.get_response_output = function (responses, gen) {
    var title = "",
      description = "";
    if (gen.hasOwnProperty("title")) {
      title = gen.title;
    }
    if (gen.hasOwnProperty("description")) {
      description = "<div>" + gen.description + "</div>";
    }
    if (gen.response_type === "image") {
      var img = '<div><img src="' + gen.source + '" width="300"></div>';
      responses.push({
        type: gen.response_type,
        innerhtml: title + description + img,
      });
    } else if (gen.response_type === "text") {
      responses.push({
        type: gen.response_type,
        innerhtml: gen.text,
      });
    } else if (gen.response_type === "pause") {
      responses.push({
        type: gen.response_type,
        time: gen.time,
        typing: gen.typing,
      });
    } else if (gen.response_type === "option") {
      var preference = "text";
      if (gen.hasOwnProperty("preference")) {
        preference = gen.preference;
      }

      responses.push({
        type: gen.response_type,
        innerhtml: title + description + gen.options + preference,
      });
    }
  };

  self.suggestion_pick = function (generic) {
    var topSuggestionGenric = [];
    let localGeneric = generic;

    var maxConfidence = 0.0;
    var max = 0;
    for (
      var suggestionIndex = 0;
      suggestionIndex < localGeneric.suggestions.length;
      suggestionIndex++
    ) {
      var count = 0;
      var confidenceValue = 0.0;

      if (localGeneric.suggestions[suggestionIndex].value.input.entities) {
        for (
          var entityIndex = 0;
          entityIndex <
          localGeneric.suggestions[suggestionIndex].value.input.entities.length;
          entityIndex++
        ) {
          confidenceValue =
            confidenceValue +
            localGeneric.suggestions[suggestionIndex].value.input.entities[
              entityIndex
            ].confidence;
          count++;
        }
      }
      if (localGeneric.suggestions[suggestionIndex].value.input.intents) {
        for (
          var intentIndex = 0;
          intentIndex <
          localGeneric.suggestions[suggestionIndex].value.input.intents.length;
          intentIndex++
        ) {
          confidenceValue =
            confidenceValue +
            localGeneric.suggestions[suggestionIndex].value.input.intents[
              intentIndex
            ].confidence;
          count++;
        }
      }

      confidenceValue = confidenceValue / count;
      if (confidenceValue > maxConfidence) {
        maxConfidence = confidenceValue;
        topSuggestionGenric =
          localGeneric.suggestions[suggestionIndex].output.generic;
      }
    }
    console.log("end", topSuggestionGenric);
    return topSuggestionGenric;
  };
}

module.exports = function (options) {
  return new CloudandStorage(options);
};
