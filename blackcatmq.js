#!/usr/bin/env node

/*
 blackcatmq
 copyright (c) 2012,2013 Yaroslav Gaponov <yaroslav.gaponov@gmail.com>

 changes:
    9 October 2013 Chris Flook - Expose blackcatmq for use as a module

    6 February 2015 Sergey Krasnikov - Websocket server, ephemeral authorization support
*/

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
    
    self.debug = config.debug;
    self.log = function () {
      if (!self.debug) {
        return;
      }
      console.log.apply(console, Array.prototype.slice.call(arguments));
    };

    self.identifier = 'BlackCatMQ-teligent';

    self.port = config.port || 8443;
    self.host = config.host || false;
    self.interval = config.interval || 50000;
    self.serverType = config.serverType || 'https';
    self.authType = config.authType || 'none';
    self.serverOptions = config.serverOptions || {};
    self.serverOptions.key = self.serverType === 'https' ? fs.readFileSync(self.serverOptions.key) : '';
    self.serverOptions.cert = self.serverType === 'https' ? fs.readFileSync(self.serverOptions.cert) : '';

    self.connections = {};

    self.servers = [];

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

    self.createServer = function() {
        var server = require(self.serverType).createServer(self.serverOptions, function(request, response) {
            self.log((new Date()), 'got http request');
            var message = 'Websocket only.';
            response.writeHead(200, {
              'Content-Length': message.length,
              'Content-Type': 'text/plain'
            });
            response.end(message);
        });

        // Websocket server creation over http server
        var wsServer = new (require('websocket').server)({
            httpServer: server,
            autoAcceptConnections: false
        });

        // Web socket connection request from client handling
        wsServer.on('request', function(request) {
            self.log((new Date()), 'got websocket request');

            var connection;
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
                connection = request.accept(selectedProtocol, request.origin);
            } else {
                request.reject(404 /*?*/, 'not accepted protocol(s)');
                return;
            }

            self.log((new Date()), 'accepted websocket request');

            var remoteAddress = connection.remoteAddress;
            util.log(util.format('client is connected from %s', remoteAddress));

            var data = '';
            connection.on('message', function(message) {
                self.log(util.format('got message %s of type %s from %s', message.utf8Data, message.type, remoteAddress));
                if (message.type === 'utf8') {
                    var chunk = message.utf8Data;
                    if (self.debug == 'all') {
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

                                self.log(util.inspect(frame));


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
        return server;
    };
};

/*
 start server
*/
BlackCatMQ.prototype.start = function(callback) {
    var self = this;
    var server = null;
    var hostsCount = 1;
    var hostCurrent = 0;
    var startFunc = function () {
        hostCurrent++;
        if (hostCurrent == hostsCount && !self.timerID) {

            self.timerID = setInterval(function() { self.timer(); }, self.interval);
            self.log(util.format("timer for queue started"));

            self.servers.forEach(function (server) {
                var addr = server.address();
                self.log(addr);
                util.log(util.format("server is started on %s:%s ...", addr.address, addr.port));
            });
            util.log('all servers started');

            if (callback && typeof callback === 'function') {
                return callback();
            }
        }
    };
    // Port binding
    if (!self.host) {
        self.log('binding server to all ips with port', self.port);
        server = self.createServer();
        self.servers.push(server);
        server.listen(self.port, startFunc);
    } else {
        self.host = [].concat(self.host);
        hostsCount = self.host.length;
        self.host.forEach(function (serverIP) {
          var matches = serverIP.match(/^([^:]+)\:([^:]*)$/) || [];
          var host  = matches[1] || serverIP;
          var port = matches[2] || self.port;
            if (port) {}
            self.log('binding server to ip with port', host, port);
            server = self.createServer();
            self.servers.push(server);
            server.listen(port, host, startFunc);
        });
    }
    

};

/*
 stop server
*/
BlackCatMQ.prototype.stop = function(callback) {
    var self = this;
    var serversCount = self.servers.length;
    var serversStopped = 0;
    self.servers.forEach(function (server) {
        if (server._handle) {
            var addr = server.address();
            server.close(function() {
                util.log('server on ', addr, 'is stopped');
                serversStopped++;
                if (serversStopped == serversCount) {
                    clearInterval(self.timerID);
                    self.timerID = false;

                    self.servers.splice(0, self.servers.length);
                    if (callback && typeof callback === 'function') {
                        return callback();
                    }
                }
            });
        } else {
            util.log('server is already stopped');
        }
    });
};

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
        
        var login = frame.header.login;
        if (!login) {
            return stomp.ServerFrame.ERROR('connect error','login is required');    
        }
        var passcode = frame.header.passcode;
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

            self.log(expectedPassword, passcode, expireDate, nowDate, login, self.auth.secret);

            if(expectedPassword != passcode || parseInt(expireDate)*1000 < nowDate) {
                return stomp.ServerFrame.ERROR('connect error','incorrect login or passcode');
            }

            self.connections[sessionID] = connection;
            return stomp.ServerFrame.CONNECTED(sessionID, self.identifier);
        }
    }

    self.connections[sessionID] = connection;
    return stomp.ServerFrame.CONNECTED(sessionID, self.identifier);
};

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
    
    var destination = frame.header.destination;
    if (!destination) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no destination argument');
    }

    var id = frame.header.id;
    // v1.1 id is required
    if (!id) {
        id = 'destination';
    }

    if (!Array.isArray(connection.subscriptions[destination])) {
      connection.subscriptions[destination] = [];
    }

    connection.subscriptions[destination].push(id);

    // TODO: v1.1 client-individual ack type
    if (frame.header.ack && frame.header.ack === 'client') {
        connection.ack_list.push(id);
    }
};

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

    var id = frame.header.id;
    var destination = frame.header.destination;
    if (!id && !destination) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no id or destination argument');
    }
    if (id && destination) {
      return stomp.ServerFrame.ERROR('invalid parameters','there is ambiguous data: id and destination arguments');
    }
    
    if (destination && connection.subscriptions[destination]) {
        var subscriptionIndex = connection.subscriptions[destination].indexOf('destination');
        if (subscriptionIndex >= 0) {
            connection.subscriptions[destination].splice(subscriptionIndex, 1);
        }
    } else if (id) {
        Object.keys(connection.subscriptions).forEach(function (destination) {
            var subscriptionIndex = connection.subscriptions[destination].indexOf(id);
            if (subscriptionIndex != -1) {
              connection.subscriptions[destination].splice(subscriptionIndex, 1);
              return false;
            }
        });
    }
};

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
    
    var destination = frame.header.destination;
    if (!destination) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no destination argument');
    }
    
    var transaction = frame.header.transaction;
    if (transaction) {
        self.transactions[transaction].push(frame);
    }

    var send = function (inConnection, messageID, subscriptionID, destination) {
        var headers = { 'message-id': messageID };
        if (subscriptionID != 'destination') {
            headers.subscription = subscriptionID;
        }

        sender(inConnection, stomp.ServerFrame.MESSAGE(destination, headers, frame.body));
    };

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

            send(inConnection, messageID, subscriptionID, destination);
        } else {
            inConnection.subscriptions[destination].forEach(function(subscriptionID) {
                send(inConnection, messageID, subscriptionID, destination);
            });
        }
    });
};

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
};


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
};

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
    
    var transaction = frame.header.transaction;
    if (!transaction) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no transaction argument');
    }
    
    self.transactions[transaction] = [];
};

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

    var transaction = frame.header.transaction;
    if (!transaction) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no transaction argument');
    }
    
    delete self.transactions[transaction];
};

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
    
    var transaction = frame.header.transaction;
    if (!transaction) {
        return stomp.ServerFrame.ERROR('invalid parameters','there is no transaction argument');
    }
    
    self.transactions[transaction].forEach(function(frame) {
        self.send(null, frame);
    });    
    delete self.transactions[transaction];
};


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
};

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
            console.error('error:' + err + err.stack);
            if (server) {
                server.stop(function () {
                    util.log('Got uncaughtException. Server stopped.');
                    server = false;
                });
            }
        });
        
        process.once('SIGINT', function() {
            if (server) {
                server.stop(function () {
                    util.log('Got SIGINT. Server stopped.');
                    server = false;
                });
            }
            
        });    
    });
}

function create(config){
    return new BlackCatMQ(config || {});
}

module.exports = {
    create: create
};
