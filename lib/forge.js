var dhcpd = require('node-dhcpd');
var tftpd = require('tftp');
var http = require('http');
var router = require('lib/routes');
var lmdb = require('node-lmdb');

function Forge (opts) {
  var self = this;
  self.tftpd = tftpd.createServer({
    host: '0.0.0.0',
    port: 69,
    root: './static/',
    denyPUT: true
  });

  self.dhcpd = dhcpd.createServer('udp4');
  self.dhcpd.bind(67);

  self.httpd = http.createServer(function (req, res) {
    var path = url.parse(req.url).pathname;
    var match = router.match(path);
    match.fn(req, res, match);
  }).listen(80);
}

Forge.prototype.initialize_dhcpd = function initialize_dhcpd () {
  var self = this;
  var config = {
    "leaseTime": 36400
  };

};

Forge.prototype.initialize_lmdb = function initialize_lmdb (opts) {
  var self = this;
  var env = new lmdb.Env();
  env.open({
        path: "./data/forge.db"
  });
  var dbi = env.openDbi({
    name: opts.ip_range,
    create: true
  });
};

module.exports = Forge;
