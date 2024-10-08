import express from "express";
import http from "http";


const app = express();
const server = http.createServer(app);


app.use(express.static("data"));

server.listen(8080);