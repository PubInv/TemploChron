/*
GeoChronicle allows you to create map applications and record geomarkers in the app of your choosing.
Copyright (C) 2021 Robert Read, Diego Aspinwall and Neil Martis
Copyright (C) 2022 Robert L. Read

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const express = require("express");
const app = express();
var cors = require("cors");
require("dotenv").config({ path: __dirname + "/.env" });

// const firebase = require("firebase/app");

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");

initializeApp({
  credential: applicationDefault(),
  databaseURL: process.env.databaseURL,
  storageBucket: process.env.storageBucket,
});

const database = getDatabase();
const storage = getStorage();
const bucket = storage.bucket();

module.exports = {
  database,
  storage,
  bucket,
};

const ref = database.ref();

app.use(express.static(__dirname));
app.use(cors());

var returnFirebaseSnapshot = (req, ref, res) => {
  var appName = req.query.appName;
  database
    .ref("/apps/" + appName + ref)
    .once("value")
    .then((snapshot) => {
      res.send(JSON.stringify(snapshot));
    });
};

app.get('/mapbox', function (req, res) {
  res.json({
    mapboxkey: process.env.MAPBOXGL_ACCESSTOKEN
  })

})

app.get("/returnTags", function (req, res) {
  returnFirebaseSnapshot(req, "/tags/", res);
});

// I could get a specific tag with a query param
// but REST should not make that necessary
app.get("/tags/*", function (req, res) {
  returnFirebaseSnapshot(req, req.path, res);
});

app.get("/reconfigureFromApp", function (req, res) {
  returnFirebaseSnapshot(req, "", res);
});
app.get("/deleteAllMarkers", function (req, res) {
  var appName = req.query.appName;
  console.log("in delete");
  database
    .ref("/apps/" + appName + "/tags")
    .set(null,function (error) {
      if (error) {
        console.log("ERROR:", error);
      }
    })
    .then((snapshot) => {
      console.log("successful Delete");
      res.send(JSON.stringify("Successfully removed "+appName+ " tags"));
    });
});

app.get("/checkForAppInDatabase", function (req, res) {
  var appName = req.query.appName;
  database
    .ref("/apps/" + appName)
    .once("value")
    .then((snapshot) => {
      res.send(JSON.stringify({ appExists: snapshot.exists() }));
    });
});

function writeTagIntoDB(obj, req) {
  database
    .ref("/apps/" + req.query.appname + "/tags/" + req.query.tagId)
    .set(obj, function (error) {
      if (error) {
          console.log("ERROR:", error);
      }
    });
}

app.get("/writeTag", function (req, res) {
    console.log("Called |writeTag|");
  var obj = req.query.taginfo;
  obj["latitude"] = parseFloat(obj.latitude);
  obj["longitude"] = parseFloat(obj.longitude);
  writeTagIntoDB(obj, req);
});

app.get("/actuallyCreate", function (req, res) {
  var config = req.query.obj;
  for (const property in config) {
    if (config[property] == "false") {
      config[property] = false;
    }
    if (config[property] == "true") {
      config[property] = true;
    }
  }
  config.tags = {};
  database
    .ref("apps/" + req.query.appname)
    .set(config, function (error) {
      if (error) {
        // The write failed...
        console.log("ERROR:", error);
      } else {
        // Data saved successfully!
        console.log("SUCCESS");
      }
    });
});


app.get("/updateDescription", async function (req, res) {
  try {
    const appName = req.query.appName;
    const tagId = req.query.tagId;
    const description = req.query.description;

    const path = `/apps/${appName}/tags/${tagId}/description`;

    console.log("databaseURL:", process.env.databaseURL);
    console.log("Writing path:", path);
    console.log("Description:", description);

    const ref = database.ref(path);

    await ref.set(description);

    // Immediately read it back to verify the write
    const snapshot = await ref.once("value");

    console.log("Value after write:", snapshot.val());

    res.json({
      success: true,
      path: path,
      value: snapshot.val()
    });
  } catch (error) {
    console.error("Firebase update error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const multer = require("multer");
const os = require("os");
//const ExifReader = require('exif-js')
const ExifReader = require("exifreader");
const fs = require("fs");

const upload = multer({ storage: multer.memoryStorage() });

app.post("/upload", upload.single("file"),async function (req, res) {
  // by the time we get here, multer
  // has already generated a hash name.
  // This has lost the mimetype information.
  console.log("req.body");
  console.log(req.body);
  var myobj = JSON.parse(req.body.obj);
  console.log("myobj");
  console.log(myobj);
  const title = req.body.title;
  const file = req.file;
    console.log("title",title);
    console.log("file",file);
// file.filename = file.originalname;
//console.log("file.path");
//console.log(file.path);
// console.log("file.path");

  var fake_req = {};
  fake_req.query = {};

  fake_req.query.appname = myobj.appname;
  fake_req.query.tagId = myobj.tagId;

  var obj = {};
    try {
        const fileRef = bucket.file(file.originalname);
        console.log("fileRef",fileRef);

        // TODO: There seems to be no error handling here....
        await fileRef.save(file.buffer, {
            metadata: {
                contentType: file.mimetype || "application/octet-stream",
            },
        });

        console.log("Firebase Storage upload successful:", fileRef.name);

        // Store a path or URL for later use.
        const filePath = `${bucket.name}/${file.originalname}`;

        myobj.taginfo.filePath = filePath;
        myobj.taginfo.message = filePath;

        console.log("myobj about to be written",myobj);
        writeTagIntoDB(myobj.taginfo, fake_req);
    } catch (err) {
        console.error(err);
    }

  res.sendStatus(200);
});


app.get("/download/:filename", async function (req, res) {
    const filename = req.params.filename;
    const fileRef = bucket.file(filename);


    // TODO: If filename is "undefined", the rest of this code should NOT execute!
    if (!filename) {
         console.log("INTERNAL ERROR FILNAME UNDEFINED:", filename);
        res.status(404)
            .send("filename undefined, try refreshing!");
    }
    console.log("Download requested:", filename);
    console.log("Bucket:", bucket.name);
    console.log("Object:", fileRef.name);

    try {
        const [metadata] = await fileRef.getMetadata();

        console.log("File found:", {
            name: metadata.name,
            size: metadata.size,
            contentType: metadata.contentType
        });

        res.setHeader(
            "Content-Type",
            metadata.contentType || "application/octet-stream"
        );

        const stream = fileRef.createReadStream();

        stream.on("error", function (error) {
            console.error("STREAM ERROR:", error);

            if (res.headersSent) {
                res.destroy(error);
            } else {
                res.status(500).send("Error streaming image");
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error("DOWNLOAD ERROR:", {
            code: error.code,
            message: error.message,
            stack: error.stack
        });

        if (!res.headersSent) {
            res.status(error.code === 404 ? 404 : 500)
               .send("Error retrieving image");
        }
    }
});

// app.get("/download/:filename", async function (req, res) {
//     try {
//         console.log("IN DOWNLOAD XXXXXXX\n");
//         const filename = req.params.filename;
//  //       console.log("req",req);

//         const fileRef = bucket.file(filename);


//         console.log("Bucket:", bucket.name);
//         console.log("Object path:", fileRef.name);
//         console.log("Storage URI:", `gs://${bucket.name}/${fileRef.name}`);

//         console.log("filename",filename);
//         // Check that the object exists
//         const [exists] = await fileRef.exists();

//         if (!exists) {
//             console.log("Image not found!",filename);
//             return res.status(404).send("Image not found!");
//         }

//         // Get metadata so we can send the correct MIME type
//         const [metadata] = await fileRef.getMetadata();

//         res.setHeader(
//             "Content-Type",
//             metadata.contentType || "application/octet-stream"
//         );

//         // Stream the image from Google Cloud Storage to the browser
//         fileRef
//             .createReadStream()
//             .on("error", function (error) {
//                 console.error("Error reading image:", error);
//                 if (!res.headersSent) {
//                     res.status(500).send("Error retrieving image");
//                 }
//             })
//             .pipe(res);
//     } catch (error) {
//         console.error("Error retrieving image:", error);
//         res.status(500).send("Error retrieving image");
//   }
// });




const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("GeoChronicle listening on port " + port);
});
