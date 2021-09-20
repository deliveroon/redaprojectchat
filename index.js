const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
var cors = require('cors')
var mysql      = require('mysql');

require('dotenv').config()

let pool = mysql.createPool({
  host     : 'database-1.cyeogm7cwnns.us-east-2.rds.amazonaws.com',
  user     : 'admin',
  password : 'test110110',
  database : 'test'
});

pool.on('connection', function (_conn) {
    if (_conn) {
        console.log('Connected the database via threadId %d!!', _conn.threadId);
        _conn.query('SET SESSION auto_increment_increment=1');
    }
});
 

app.use(cors({
    origin: 'http://localhost:8100',

}));

var connectedUsers = [];

function getAvailableUsers(){
  var stringReturn = '';
  for(let key in connectedUsers){
    if(connectedUsers[key].isSpinning === true && connectedUsers[key].speakingWith === null )
    {
      stringReturn += "'" + connectedUsers[key].socket.username + "',";
    }    
  }
  stringReturn = stringReturn.slice(0,-1);
  return stringReturn;
}

io.use((socket, next) => {
    const username = socket.handshake.auth.username;
    if (!username) {
      return next(new Error("invalid username"));
    }
    socket.username = username;
    next();
});

io.on("connection", socket => {
    
    connectedUsers.push({
        socket: socket,
        isSpinning: false,
        speakingWith: null
    });

    socket.on("disconnect", (reason) => {

      const user_exit = connectedUsers.find(user => user.socket.username === socket.username);

      if(user_exit.speakingWith !== null){
        const speaker_index = connectedUsers.findIndex(user => user.speakingWith.socket.username === socket.username);
        if(speaker_index !== -1){
          connectedUsers[speaker_index].speakingWith = null;
          connectedUsers[speaker_index].socket.emit("speaker disconnect");
        }
      }     
      connectedUsers = connectedUsers.filter(user => user.socket.username !== socket.username);
    });

    socket.on("start spin", () => { 

      const index = connectedUsers.findIndex(user => user.socket.username === socket.username);
      if(index !== -1){
        connectedUsers[index].isSpinning = true;
      }
      else {
        socket.emit("not found", null);
      }

      pool.query(`
        SELECT us2.id,
        us2.username,
        SUM(mc.coefficient)/2 as matching_point
        FROM user us1, 
        user us2,
        user_genre_search_genre ugsg1,
        user_genre_search_genre ugsg2,
        user_profile up1,
        user_profile up2,
        matching_coeff mc
        WHERE us1.username = '${socket.username}'
        AND us1.id != us2.id
        ${getAvailableUsers().length > 0 ? `AND us2.username IN (${getAvailableUsers()}) ` : `AND us2.username IN ('')`}
        AND us2.username NOT IN (SELECT us2.username as friend
          FROM friend_list fl1,
          user us1,
          user us2
          WHERE us1.username = '${socket.username}'
          AND us1.id = fl1.userId
          AND fl1.friendId = us2.id)
        AND us2.username NOT IN (SELECT us2.username as friend
          FROM black_list fl1,
          user us1,
          user us2
          WHERE us1.username = '${socket.username}'
          AND us1.id = fl1.userId
          AND fl1.friendId = us2.id)
        AND ugsg1.userId = us1.id
        AND ugsg2.userId = us2.id
        AND ugsg1.genreId = us2.genreId
        AND ugsg2.genreId = us1.genreId
        AND up1.userId = us1.id
        AND up2.userId = us2.id
        AND mc.firstAnswerId = up1.answerId
        AND mc.secondAnswerId = up2.answerId
        ORDER BY matching_point DESC;
      ` , function (error, results, fields) {

        if (error) throw error;

        if(results[0].username !== null){
          const match_user_index = connectedUsers.findIndex(user => user.socket.username === results[0].username);
          const match_user = connectedUsers[match_user_index];
          connectedUsers[index].isSpinning = false;
          connectedUsers[index].speakingWith = match_user;
          connectedUsers[index].startSpeakDate = new Date().toISOString();
          connectedUsers[match_user_index].isSpinning = false;
          connectedUsers[match_user_index].speakingWith = connectedUsers[index];
          connectedUsers[match_user_index].startSpeakDate = new Date().toISOString();
          socket.emit("matched", {
            username: results[0].username,
            matching_point: results[0].matching_point,
            startSpeakDate: new Date().toISOString(),
          });
          connectedUsers[match_user_index].socket.emit("matched", {
            username: socket.username,
            matching_point: results[0].matching_point,
            startSpeakDate: new Date().toISOString(),
          });
        }      
      });    
    });

    socket.on("stop spin", () => {
      const index = connectedUsers.findIndex(user => user.socket.username === socket.username);
      if(index !== -1){
        connectedUsers[index].isSpinning = false;
      }
      else {
        socket.emit("not found", null);
      }
    });

    socket.on("private message dating", (content) => {
      const user = connectedUsers.find(user => user.socket.username === socket.username);
      user.speakingWith.socket.emit("private message dating", content);
    });

    socket.on("dating end", () => {
      const index = connectedUsers.findIndex(user => user.socket.username === socket.username);
      if(index !== -1){
        connectedUsers[index].speakingWith = null;
      }
      else {
        socket.emit("not found", null);
      }
    });

    socket.on("dating abort", () => {
      const user_exit_index = connectedUsers.findIndex(user => user.socket.username === socket.username);
      const user_exit = connectedUsers[user_exit_index];
      if(user_exit.speakingWith !== null){
        const speaker_index = connectedUsers.findIndex(user => user.speakingWith.socket.username === socket.username);
        if(speaker_index !== -1){
          connectedUsers[speaker_index].socket.emit("speaker abort");
        }
        connectedUsers[user_exit_index].speakingWith = null;
      }  
    });

    socket.on("dating next", () => {
      const user_next_index = connectedUsers.findIndex(user => user.socket.username === socket.username);
      const user_next = connectedUsers[user_next_index];
      if(user_next.speakingWith !== null){
        if (user_next.speakingWith.socket){
          const speaker_index = connectedUsers.findIndex(user => user.speakingWith.socket.username === socket.username);
          if(speaker_index !== -1){
            connectedUsers[speaker_index].socket.emit("speaker next you");
          }
        }
        connectedUsers[user_next_index].speakingWith = null;
      }  
    });

    socket.on("private message", ({content, to}) => {
      const user = connectedUsers.find(user => user.socket.username === to);

      user.socket.emit("private message", {
        content: content,
        from: socket.username
      })
    });
  
});

http.listen(+process.env.PORT, () => {
    console.log('Listening on port 4000');
});

