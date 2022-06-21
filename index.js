const express = require('express');
const app = express();

const mongodb = require('mongodb');
const ObjectId = mongodb.ObjectId;
const mongoClient = mongodb.MongoClient;
const fs = require("fs");
const multer = require("multer")
const util = require("util")

const unlinkFile = util.promisify(fs.unlink)
const upload = multer({ dest: './uploads' })

const { uploadFile, getFileStream } = require('./s3bucket')

const mainURL = "http://localhost:5000/";
let database = null;

let http = require('http').createServer(app);

app.use("/public", express.static(__dirname + "/public"));
app.set("view engine", "ejs")
app.use(express.json());

const expressSession = require("express-session");
app.use(expressSession({
    "key": "user_id",
    "secret": "User secret object ID",
    "resave": true,
    "saveUninitialized": true
}));


const bcrypt = require('bcrypt');

const bodyParser = require('body-parser');
const { request } = require('http');
app.use(bodyParser.json({ limit: "10000mb" }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10000mb", parameterLimit: 1000000 }));

function getUser(userId, callBack) {
    database.collection("users").findOne({
        "_id": ObjectId(userId)
    }, function (error, result) {
        if (error) {
            console.log(error);
            return;
        }
        if (callBack !== null) {
            callBack(result);
        }

    });
}

const db = require("./config/keys").mongoURI; 
// const db = "mongodb://localhost:27017";
 
http.listen(process.env.PORT || 5000, function () {
    console.log('Server has started...');

    mongoClient.connect(db, { useUnifiedTopology: true }, function (error, client) {
        if (error) {
            console.log(error);
            return;
        }
        database = client.db("Image_sharing_app");

        app.get("/", (req, res) => {

            database.collection("images").find().sort({
                "createdAt": -1
            }).toArray((err, images) => {
                if (req.session.user_id) {
                    getUser(req.session.user_id, function (user) {
                        res.render("index", {
                            "isLogin": true,
                            "query": req.query,
                            "user": user,
                            "images": images 
                        })
                    })
                } else {
                    res.render("index", {
                        "isLogin": false,
                        "query": req.query,
                        "images": images
                    })
                }
            })
        })

        app.get("/register", (req, res) => {
            res.render("register", {
                "query": req.query
            })
        });

        app.post("/register", (req, res) => {
            if (req.body.password !== req.body.confirm_password) {
                res.redirect("/register?error=mismatch");
                return
            }

            database.collection("users").findOne({
                "email": req.body.email
            }, (err, user) => {
                if (user === null) {
                    bcrypt.hash(req.body.password, 10, (err, hash) => {
                        database.collection("users").insertOne({
                            "name": req.body.name,
                            "email": req.body.email,
                            "password": hash
                        }, (err, data) => {
                            res.redirect("/login?message=registered");
                        })
                    })
                } else {
                    res.redirect("/register?error=exists");
                }
            })
        });

        app.get("/login", (req, res) => {
            res.render("login", {
                "query": req.query
            })
        })

        app.post("/login", (req, res) => {
            const email = req.body.email;
            const password = req.body.password;

            database.collection("users").findOne({
                "email": email
            }, (err, user) => {
                if (user === null) {
                    res.redirect("/login?error=not_exists")
                } else {
                    bcrypt.compare(password, user.password, (err, isPasswordVerify) => {
                        if (isPasswordVerify) {
                            req.session.user_id = user._id;
                            res.redirect("/")
                        } else {
                            res.redirect("/login?error=wrong_password")
                        }
                    })
                }
            })
        })

        app.get("/logout", (req, res) => {
            req.session.destroy();
            res.redirect("/");
        })

        app.get("/news_feed", (req, res) => {
            if (req.session.user_id) {
                getUser(req.session.user_id, (user) => {
                    database
                        .collection("news_feed")
                        .find({
                            "user._id": ObjectId(req.session.user_id),
                        })
                        .sort({
                            createdAt: -1,
                        })
                        .toArray((err, news_feed) => {
                            res.render("index", {
                                isLogin: true,
                                query: req.query,
                                News_Feed: news_feed,
                                user: user,
                            });
                        });
                });
            } else {
                res.redirect("/login");
            }
        });
  
        app.get("/images/:key", (req, res) => {
            const key = req.params.key

            const readStream = getFileStream(key) 

            res.attachment(key);
            readStream.pipe(res)
        })

        app.post("/news_feed", upload.single("image"),  async (req, res) => {
            if(req.session.user_id){
                const file = req.file
                const result = await uploadFile(file)
                await unlinkFile(file.path)
                console.log("This is from the back", result.Location)

                getUser(req.session.user_id, (user) => {
                   delete user.password;
                   const currentTime = new Date().getTime();
                   console.log("This is our body",req.body)
                   let caption = req.body.caption
                   console.log("This is caption",caption)

                   database.collection("images").insertOne({
                       "caption": caption,
                       "filePath": `/images/${result.key}`,
                       "user": user,
                       "createdAt": currentTime,
                       "likers": [],
                       "comments": []
                   }, (err, data) => {
                        res.redirect("/?message=image_uploaded");
                   })
                })
            } else {
                res.redirect("/login");
            }
        })

        app.get("/view-image", (req, res) => {
            database.collection("images").findOne({
                "_id": ObjectId(req.query._id)
            }, (err, image) => {
                if(req.session.user_id){
                    getUser(req.session.user_id, (user) => {
                        res.render("view-image", {
                            "isLogin": true,
                            "query": req.query,
                            "user": user,
                            "image": image
                        })
                    })
                } else {
                    res.render("view-image", {
                        "isLogin": false,
                        "query": req.query,
                        "image": image
                    })
                }
            })
        })

        app.post("/do-like", (req, res) => {
            if(req.session.user_id){
                database.collection("images").findOne({
                    "_id": ObjectId(req.body._id),
                    "likers._id": req.session.user_id
                }, (err, video) => {
                    if(video == null) {
                        database.collection("images").updateOne({
                            "_id": ObjectId(req.body._id)
                        }, {
                            $push: {
                             "likers": {
                                    "_id": req.session.user_id
                                }
                            }
                        }, (err, data) => {
                            res.json({
                                "status": "success",
                                "message": "Image has been liked!"
                            })
                        })
                    } else { 
                       res.json({
                           "status": "error",
                           "message": "You have already liked this image."
                       }) 
                    }
                })
            } else {
                res.json({
                    "status": "error",
                    "message": "Please login to perform this action."
                })
            }  
        })

        app.post("/do-comment", (req, res) => {
            if(req.session.user_id){
                const comment  = req.body.comment
                var _id = req.body.id;

                getUser(req.session.user_id, (user) => {
                    delete user.password;

                    database.collection("images").findOneAndUpdate({
                        "_id": ObjectId(_id)
                    }, {
                        $push: {
                            "comments": {
                                "_id": ObjectId(),
                                "user": user,
                                "comment": comment,
                                "createdAt": new Date().getTime()
                            }
                        }
                    }, (err, data) => { 
                        res.redirect("/view-image?_id=" + _id + "&message=success#comments" )
                    })
                })
            } else {
                res.redirect("/view-image?_id=" + _id + "&error=not_login#comments")
            }
        })
    })
});  