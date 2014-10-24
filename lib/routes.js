
var Router = require('routes');
var router = new Router();
var st = require('st');
var fs = require('fs');

var mount = st({
  path: __dirname + '/static/', // resolved against the process cwd
  url: 'boot/', // defaults to '/'

  // indexing options
  index: 'index', // auto-index, the default

  dot: false // default: return 403 for any url with a dot-file part

});

router.addRoute('/chain', function(req, res, params, splats) {
  console.log("Got a CHAIN request");
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end("#!ipxe\n\necho Attempting to boot into the chain... \nchain http://${next-server}/boot/${mac}\n");
});

router.addRoute('/boot/:macaddr', function boot(req, res, params, splats) {
  console.log("Got a BOOT request");
  console.log("Just got word that "+params.params.macaddr+" just booted");

  var stat = fs.statSync(__dirname + '/static/' + params.params.macaddr);
  if(stat && stat.isDirectory()){
    mount(req, res);
  } else {
    req.url = '/boot/default';
    mount(req, res);
  }
});

module.exports = router;

