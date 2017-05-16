/**
 * Copyright 2017, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the `License`);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an `AS IS` BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Example of using the Google Cloud IoT Core device manager to administer
 * devices.
 *
 * This example uses the Device Manager API to create, retrieve, disable, list
 * and delete Cloud IoT Core devices and registries, using both RSA and
 * elliptic curve keys for authentication.
 *
 * To start, follow the instructions on the Developer Guide at
 * cloud.google.com/iot to create a service_account.json file and API key.
 *
 * Register your device as described in the parent README.
 *
 * Usage example:
 *
 *   $ npm install
 *   $ nodejs cloudiot-device-manager-example.js \
 *       --project_id=my-project-id \
 *       --pubsub_topic=projects/my-project-id/topics/my-topic-id \
 *       --api_key=YOUR_API_KEY \
 *       --ec_public_key_file=ec_public.pem \
 *       --rsa_certificate_file=rsa_cert.pem \
 *       --service_account_json=service_account.json
 *
 * Troubleshooting:
 *
 * If you get a 400 error when running the example, with the message "The API
 * Key and the authentication credential are from different projects" it means
 * that you are using the wrong API Key. Ensure that you are using the API key
 * from Google Cloud Platform's API Manager's Credentials page.
 */
'use strict';

var async = require('async');
var fs = require('fs');
var google = require('googleapis');
var program = require('commander');

program.description('Example Google Cloud IoT device manager integration')
    .option('--project_id <project_id>', 'GCP cloud project name.')
    .option('--pubsub_topic <pubsub_topic>', 'Cloud Pub/Sub topic to use.')
    .option('--api_key <api_key>', 'Your API key.')
    .option(
        '--ec_public_key_file <ec_public_key_file>', 'Path to EC public key.',
        'ec_public.pem')
    .option(
        '--rsa_certificate_file <rsa_certificate_file>',
        'Path to RSA certificate file.', 'rsa_cert.pem')
    .option('--cloud_region <cloud_region>', 'GCP cloud region.', 'us-central1')
    .option(
        '--service_account_json <service_account_json>',
        'Path to service account JSON file.', 'service_account.json')
    .option(
        '--registry_id <registry_id>',
        'Custom registry id. ' +
            'If not provided, a unique registry id will be generated.',
        '')
    .parse(process.argv);

var API_VERSION = 'v1alpha1';
var DISCOVERY_API = 'https://cloudiot.googleapis.com/$discovery/rest';
var SERVICE_NAME = 'cloudiot';

// Lookup the registry, assuming that it exists.
function lookupRegistry(client, registryName, callback) {
  client.projects.locations.registries.get(
      {name: registryName}, function(err, data) {
        if (err) {
          console.log('Could not look up registry');
          console.log(err);
        } else {
          console.log('Looked up existing registry');
          console.log(data);
        }
        callback(err);
      });
}

// Create a new registry, or look up an existing one if it doesn't exist.
function lookupOrCreateRegistry(
    client, registryId, parentName, pubsubTopic, callback) {
  client.projects.locations.registries.create(
      {
        parent: parentName,
        id: registryId,
        resource: {eventNotificationConfig: {pubsubTopicName: pubsubTopic}}
      },
      function(err, data) {
        if (err) {
          if (err.code == 409) {
            // The registry already exists - look it up instead.
            lookupRegistry(client, callback);
            return;
          } else {
            console.log('Could not create registry');
            console.log(err);
          }
        } else {
          console.log('Successfully created registry');
          console.log(data);
        }
        callback(err);
      });
}

// Create a new device with the given id. The body defines the parameters for
// the device, such as authentication.
function createDevice(client, deviceId, registryName, body, callback) {
  console.log('Creating device ' + deviceId);
  client.projects.locations.registries.devices.create(
      {parent: registryName, id: deviceId, resource: body},
      function(err, data) {
        if (err) {
          console.log('Could not create device');
          console.log(err);
        } else {
          console.log('Created device');
          console.log(data);
        }
        callback(err);
      });
}

// Create a device using RS256 for authentication.
function createDeviceWithRs256(
    client, deviceId, registryName, rsaCertificateFile, callback) {
  var body = {
    credentials: [{
      publicKey: {
        format: 'RSA_X509_PEM',
        key: fs.readFileSync(rsaCertificateFile).toString()
      }
    }]
  };
  createDevice(client, deviceId, registryName, body, callback);
}

// Add ES256 authentication to the given device.
function patchEs256ForAuth(
    client, deviceId, registryName, ecPublicKeyFile, callback) {
  var patch = {
    credentials: [{
      publicKey: {
        format: 'ES256_PEM',
        key: fs.readFileSync(ecPublicKeyFile).toString()
      }
    }]
  };
  var deviceName = registryName + '/devices/' + deviceId;
  client.projects.locations.registries.devices.patch(
      {name: deviceName, updateMask: 'credentials', resource: patch},
      function(err, data) {
        if (err) {
          console.log('Error patching device ' + deviceId);
          console.log(err);
        } else {
          console.log('Patched device ' + deviceId);
          console.log(data);
        }
        callback(err);
      });
}

// List all of the devices in the given registry.
function listDevices(client, registryName, callback) {
  client.projects.locations.registries.devices.list(
      {parent: registryName}, function(err, data) {
        if (err) {
          console.log('Could not list devices');
          console.log(err);
        } else {
          console.log('Current devices in registry:');
          console.log(data['devices']);
        }
        callback(err);
      });
}

// Delete the given device from the registry.
function deleteDevice(client, deviceId, registryName, callback) {
  var deviceName = registryName + '/devices/' + deviceId;
  client.projects.locations.registries.devices.delete(
      {name: deviceName}, function(err, data) {
        if (err) {
          console.log('Could not delete device ' + deviceId);
          console.log(err);
        } else {
          console.log('Successfully deleted device ' + deviceId);
          console.log(data);
        }
        callback(err);
      });
}

// Delete the given registry. Note that this will only succeed if the registry
// is empty.
function deleteRegistry(client, registryName, callback) {
  client.projects.locations.registries.delete(
      {name: registryName}, function(err, data) {
        if (err) {
          console.log('Could not delete registry');
          console.log(err);
        } else {
          console.log('Successfully deleted registry');
          console.log(data);
        }
        callback(err);
      });
}

// Set up authentiation using the downloaded service_account.json file.
function setUpAuth() {
  var serviceAccount =
      JSON.parse(fs.readFileSync(program.service_account_json));
  var jwtAccess = new google.auth.JWT();
  jwtAccess.fromJSON(serviceAccount);
  // Note that if you require additional scopes, they should be specified as a
  // string, separated by spaces.
  jwtAccess.scopes = 'https://www.googleapis.com/auth/cloud-platform';
  // Set the default authentication to the above JWT access.
  google.options({auth: jwtAccess});
}

setUpAuth();

var discoveryUrl =
    DISCOVERY_API + '?version=' + API_VERSION + '&key=' + program.api_key;

google.discoverAPI(discoveryUrl, {}, function(err, client) {
  var registryId = program.registry_id;
  // If no registryId is specified, create a unique one.
  if (registryId.length == 0) {
    registryId = 'nodejs-example-registry-' + (new Date()).getTime();
  }
  // The project/location's URI
  var parentName =
      'projects/' + program.project_id + '/locations/' + program.cloud_region;
  // The registry's URI
  var registryName = parentName + '/registries/' + registryId;
  var pubsubTopic = program.pubsub_topic;

  var rs256deviceId = 'rs256-device';
  var es256deviceId = 'es256-device';

  // Set up a series of async functions for the demo. The chain terminates on
  // the first error encountered.
  async.series([
    function(callback) {
      // Lookup our registry, or create it if it does not exist.
      lookupOrCreateRegistry(
          client, registryId, parentName, pubsubTopic, callback);
    },
    function(callback) {
      // Create a device that uses an RSA key for authentication.
      createDeviceWithRs256(
          client, rs256deviceId, registryName, program.rsa_certificate_file,
          callback);
    },
    function(callback) {
      // List all of the devices in the registry.
      listDevices(client, registryName, callback);
    },
    function(callback) {
      // Create device without authentication.
      createDevice(client, es256deviceId, registryName, {}, callback);
    },
    function(callback) {
      // List all of the devices in the registry.
      listDevices(client, registryName, callback);
    },
    function(callback) {
      // Patch the device that we created without authentication to use an EC
      // key for authentication.
      patchEs256ForAuth(
          client, es256deviceId, registryName, program.ec_public_key_file,
          callback);
    },
    function(callback) {
      // List all of the devices in the registry.
      listDevices(client, registryName, callback);
    },
    function(callback) {
      // Delete the RSA authenticated device from the registry.
      deleteDevice(client, rs256deviceId, registryName, callback);
    },
    function(callback) {
      // Delete the EC authenticated device from the registry.
      deleteDevice(client, es256deviceId, registryName, callback);
    },
    function(callback) {
      // Finally delete the registry. This call will only succeed if the
      // registry has no devices in it.
      deleteRegistry(client, registryName, callback);
    }
  ]);
});
