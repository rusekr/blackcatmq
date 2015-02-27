#!/usr/bin/env node

/*
 blackcatmq
 copyright (c) 2012,2013 Yaroslav Gaponov <yaroslav.gaponov@gmail.com>

 changes:
    9 October 2013 Chris Flook - Expose blackcatmq for use as a module

    6 February 2015 Sergey Krasnikov - Websocket server, ephemeral authorization support
*/

var DEBUG = false;

var util = require('util');
var fs = require('fs');

var stomp = require('./lib/stomp.js');


function sender(connection, data) {
    if (data) {
        if (connection && connection.connected) {
            connection.send(data.toString());
            if (data.command === 'ERROR') {
                connection.close();
            }
        }
    }
}

function getId() {
    return 'id' + Math.floor(Math.random() * 999999999999999999999);
}

var BlackCatMQ = function (config) {
    var self = this;

    self.identifier = 'BlackCatMQ-teligent';

    self.port = config.port || 8443;
    self.host = [].concat(config.host || '0.0.0.0');
    self.interval = config.interval || 50000;
    self.serverType = config.serverType || 'https';
    self.authType = config.authType || 'none';
    self.serverOptions = config.serverOptions || {};
    self.serverOptions.key = self.serverType === 'https' ? fs.readFileSync(self.serverOptions.key) : '';
    self.serverOptions.cert = self.serverType === 'https' ? fs.readFileSync(self.serverOptions.cert) : '';

    self.connections = {};

    self.messages = { frame: {}, queue: [] };

    self.transactions = {};

    self.auth = null;
    switch (self.authType.toLowerCase()) {
        case 'ldap':
            self.auth = new require('ldapauth')(config.authOprions);
            break;
        case 'ephemeral':
            self.auth = config.authOptions;
            break;
    }

    self.server = require(self.serverType).createServer(self.serverOptions, function(request, response) {
        console.log((new Date()), 'got http request');
        var message = 'Websocket only.';
        response.writeHead(200, {
          'Content-Length': message.length,
          'Content-Type': 'text/plain'
        });
        response.end(message);
    });

    // Port binding
    self.host.forEach(function (serverIP) {
        self.server.listen(self.port, serverIP, function() {
            console.log((new Date()) + "Server is listening on ip:", serverIP, 'and port:', self.port);
        });
    });
          // Websocket server creation over http server
    self.wsServer = new (require('websocket').server)({
        httpServer: self.server,
        autoAcceptConnections: false
    });

    // Web socket connection request from client handling
    self.wsServer.on('request', function(request) {
        console.log((new Date()), 'got websocket request');

        var acceptedProtocols = [/*'v11.stomp',*/ 'v10.stomp']; //TODO: v11.stomp support - nack, heartbeat, subscriptions separate by id
        var requestedProtocols = request.requestedProtocols;
        var selectedProtocol = null;
        if (requestedProtocols.length) {
            requestedProtocols.forEach(function (protocol) {
                if (acceptedProtocols.indexOf(protocol) !== -1) {
                    selectedProtocol = protocol;
                    return;
                }
            });
        }

        if (selectedProtocol !== null) {
            var connection = request.accept(selectedProtocol, request.origin);
        } else {
            request.reject(404 /*?*/, 'not accepted protocol(s)');
            throw new Error('not accepted protocol(s)');
        }

        console.log((new Date()), 'accepted websocket request');

        var remoteAddress = connection.remoteAddress;
        util.log(util.format('client is connected from %s', remoteAddress));

        var data = '';
        connection.on('message', function(message) {
            util.log(util.format('got message %s of type %s from %s', message.utf8Data, message.type, remoteAddress));
            if (message.type === 'utf8') {
                var chunk = message.utf8Data;
                if (DEBUG) {
                    if (!self.dumpFileName) {
                        self.dumpFileName = new Date().toString() + '.dat';
                    }
                    fs.appendFileSync('./dump/' + self.dumpFileName, chunk, encoding='utf8');
                }

                data += chunk;

                var frames = data.split(stomp.DELIMETER);

                if (frames.length > 1) {
                    data = frames.pop();
                    frames.forEach(function(_frame) {
                        var frame = stomp.Frame(_frame);
                        try {
                            if (DEBUG) {
                                util.log(util.inspect(frame));
                            }

                            if (self[frame.command.toLowerCase()] && typeof self[frame.command.toLowerCase()] === 'function') {
                                sender(connection, self[frame.command.toLowerCase()].call(self, connection, frame));
                            } else {
                                sender(connection, stomp.ServerFrame.ERROR('invalid parameters','command ' + frame.command + ' is not supported'));
                            }
                        } catch (ex) {
                            sender(connection, stomp.ServerFrame.ERROR(ex, ex.stack));
                        }
                    });
                }
            }
        });

        connection.on('close', function() {
            util.log(util.format('client is disconnected from %s', remoteAddress));
            self.disconnect(connection, null);
        });
    });
}

/*
 start server
*/
BlackCatMQ.prototype.start = function(callback) {
    var self = this;
    
    self.server.listen(self.port, self.host, function() {
        var addr = self.server.address();
        util.log(util.format("server is started on %s:%s ...", addr.address, addr.port));
        
        self.timerID = setInterval(function() { self.timer(); }, self.interval);
        
        if (callback && typeof callback === 'function') {
            return callback();
        }
    });    
}

/*
 stop server
*/
BlackCatMQ.prototype.stop = function(callback) {
    var self = this;
    
    if (self.server._handle) {
        self.server.close(function() {
            util.log('server is stopped');

            clearInterval(self.timerID);

            if (callback && typeof callback === 'function') {
                return callback();
            }
        });
    } else {
        util.log('server is already stopped');
    }
}

/*
 STOMP command  -> connect
*/
BlackCatMQ.prototype.connect = function(connection, frame) {
    var self = this;

    var sessionID = getId();
    connection.sessionID = sessionID;
    connection.subscriptions = {};
    connection.ack_list = [];

    if (self.auth) {
        
        var login = frame.header['login'];
        if (!login) {
            return stomp.ServerFrame.ERROR('connect error','login is required');    
        }
        var passcode = frame.header['passcode']
        if (!passcode) {
            return stomp.ServerFrame.ERROR('connect error','passcode is required');    
        }
        
        if (self.authType === 'ldap') {
          self.auth.authenticate(login, passcode, function(err, user) {
              if (err) {
                  return stomp.ServerFrame.ERROR('connect error','incorrect login or passcode');
              }

              self.connections[sessionID] = connection;
              return stomp.ServerFrame.CONNECTED(sessionID, self.identifier);
          });
        } else if (self.authType === 'ephemeral') {
            var nowDate = (new Date()).getTime();
            var expectedPassword = require('crypto').createHmac('sha1', self.auth.secret).update(login).digest('base64');
            var expireDate = login.split(':')[0];

            console.log(expectedPassword, passcode, expireDate, nowDate, login, self.auth.secret);

            if(expectedPassword != passcode || parseInt(expireDate)*1000 < nowDate) {
                return stomp.ServerFrame.ERROR('connect error','incorrect login or passcode');
            }

            self.connections[sessionID] = connection;
            return stomp.ServerFrame.CONNECTED(sessionID, self.identifier);
        }
    }

    self.connections[sessionID] = connection;
    return stomp.ServerFrame.CONNECTED(sessionID, self.identifier);
}

/*
 STOMP command  -> stomp
*/
BlackCatMQ.prototype.stomp = BlackCatMQ.prototype.connect;

/*
 STOMP command -> subscribe
*/
BlackCatMQ.prototype.subscribe = function(connection, frame) {
    var self = this;
    
    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }
    
    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }
    
    if (!frame.header) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no header section');
    }
    
    var destination = frame.header['destination'];
    if (!destination) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no destination argument');
    }

    var id = frame.header['id'];
    // v1.1 id is required
    if (!id) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no id argument');
    }

    if (!Array.isArray(connection.subscriptions[destination])) {
      connection.subscriptions[destination] = [];
    }

    connection.subscriptions[destination].push(id);

    // TODO: v1.1 client-individual ack type
    if (frame.header['ack'] && frame.header['ack'] === 'client') {
        connection.ack_list.push(id);
    }
}

/*
 STOMP command -> unsubsctibe
*/
BlackCatMQ.prototype.unsubscribe = function(connection, frame) {
    var self = this;
    
    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }

    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }
       
    if (!frame.header) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no header section');
    }

    var id = frame.header['id'];
    if (!id) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no id argument');
    }
    
    var destination = frame.header['destination'];
    if (!destination) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no destination argument');
    }
    
    if (connection.subscriptions[destination]) {
        var pos = connection.subscriptions[destination].indexOf(connection.sessionID);
        if (pos >= 0) {
            connection.subscriptions[destination].splice(pos, 1);
        }
    }
}

/*
 STOMP command -> send
*/
BlackCatMQ.prototype.send = function(connection, frame) {
    var self = this;

    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }

    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }
   
    if (!frame.header) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no header section');
    }
    
    var destination = frame.header['destination'];
    if (!destination) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no destination argument');
    }
    
    var transaction = frame.header['transaction'];
    if (transaction) {
        self.transactions[transaction].push(frame);
    }

    Object.keys(self.connections).forEach(function (sessionID) {

        var inConnection = self.connections[sessionID];

        if (!inConnection.subscriptions[destination]) {
            return;
        }

        var messageID = getId();

        var subscriptionID =  inConnection.subscriptions[destination].pop();
        inConnection.subscriptions[destination].unshift(subscriptionID);

        if (inConnection.ack_list.indexOf(subscriptionID) >= 0) {

            self.messages.frame[messageID] = frame;
            self.messages.queue.push(messageID);


            sender(inConnection, stomp.ServerFrame.MESSAGE(destination, { 'message-id': messageID, 'subscription': subscriptionID }, frame.body));
        } else {
            inConnection.subscriptions[destination].forEach(function(subscriptionID) {

                sender(inConnection, stomp.ServerFrame.MESSAGE(destination, { 'message-id': messageID, 'subscription': subscriptionID }, frame.body));
            });
        }

    });
}

/*
 STOMP command -> ack
*/
BlackCatMQ.prototype.ack = function(connection, frame) {
    var self = this;

    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }

    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }
    
    if (!frame.header) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no header section');
    }
    
    var messageID = frame.header['message-id'];
    if (!messageID) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no message-id argument');
    }
        
    delete self.messages.frame[messageID];
    var pos = self.messages.queue.indexOf(messageID);    
    if (pos >= 0) {
        self.messages.queue.splice(pos, 1);
    }
    
    return stomp.ServerFrame.RECEIPT(messageID);
}


/*
 STOMP command -> disconnect
*/
BlackCatMQ.prototype.disconnect = function(connection, frame) {
    var self = this;

    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }

    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }
    
    delete self.connections[connection.sessionID];
}

/*
 STOMP command -> begin
*/
BlackCatMQ.prototype.begin = function(connection, frame) {
    var self = this;

    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }

    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }    
    
    if (!frame.header) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no header section');
    }
    
    var transaction = frame.header['transaction'];
    if (!transaction) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no transaction argument');
    }
    
    self.transactions[transaction] = [];
}

/*
 STOMP command -> commit
*/
BlackCatMQ.prototype.commit = function(connection, frame) {
    var self = this;

    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }

    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }
      
    if (!frame.header) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no header section');
    }

    var transaction = frame.header['transaction'];
    if (!transaction) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no transaction argument');
    }
    
    delete self.transactions[transaction];
}

/*
 STOMP command -> abort
*/
BlackCatMQ.prototype.abort = function(connection, frame) {
    var self = this;

    if (!connection.sessionID) {
        return stomp.ServerFrame.ERROR('connect error','you need connect before');
    }

    if (self.connections[connection.sessionID] !== connection) {
        return stomp.ServerFrame.ERROR('connect error','session is not correct');
    }
        
    if (!frame.header) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no header section');
    }
    
    var transaction = frame.header['transaction'];
    if (!transaction) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no transaction argument');
    }
    
    self.transactions[transaction].forEach(function(frame) {
        self.send(null, frame);
    });    
    delete self.transactions[transaction];
}


/*
 periodic task - return of lost messages 
*/
BlackCatMQ.prototype.timer = function() {
    var self = this;
    
    if (self.messages.queue.length > 0) {
        var messageID = self.messages.queue.shift();
        self.send(null, self.messages.frame[messageID]);
        delete self.messages.frame[messageID];
    }
}

if (require.main === module) {
    /*
     initalize & run server
    */
    fs.readFile(__dirname + '/blackcatmq.conf', 'utf8', function(err, data) {    
        if (err) throw err;
        
        var config = JSON.parse(data);

        var server = new BlackCatMQ(config);
        if (server) {
            server.start();
        }
        
        process.once('uncaughtException', function(err) {
            util.debug('error:' + err + err.stack);
            if (server) {
                server.stop();
            }
        });
        
        process.once('SIGINT', function() {
            if (server) {
                server.stop();
            }
            console.log('Got SIGINT.  Press Control-c to exit.');
        });    
    });
}

function create(config){
    return new BlackCatMQ(config || {});
}

module.exports = {
    create: create
}
