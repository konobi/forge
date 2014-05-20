var dhcpd = require('lib/dhcp');
var tftpd = require('tftp');
var http = require('http');
var router = require('lib/routes');
var lmdb = require('node-lmdb');

function Forge (opts) {
  var self = this;
  self.initialize_tftpd();
  self.initialize_httpd();
  self.initialize_dhcpd();
}

Forge.prototype.initialize_tftpd = function initialize_tftpd (opts) {
  var self = this;
  self.tftpd = tftpd.createServer({
    host: '0.0.0.0',
    port: 69,
    root: './static/',
    denyPUT: true
  });
};

Forge.prototype.initialize_dhcpd = function initialize_dhcpd (opts) {
  var self = this;
  self.dhcpd = new dhcpd({
    subnet: '172.16.184.0/24',
    range_start: '172.16.184.30',
    range_end: '172.16.184.60',
    routers: [ '172.16.184.1' ],
    nameservers: [ '8.8.8.8', '8.8.4.4' ],
    set_lease: set_lease,
    save_lease: save_lease,
    get_lease: get_lease,
    remove_lease: remove_lease
  });
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

Forge.prototype.initialize_httpd = function initialize_httpd (opts) {
  var self = this;
  self.httpd = http.createServer(function (req, res) {
    var path = url.parse(req.url).pathname;
    var match = router.match(path);
    match.fn(req, res, match);
  }).listen(80);
}

module.exports = Forge;
