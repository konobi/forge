var dgram = require("dgram");
var s = dgram.createSocket('udp4');

s.on('listening', function(){
  console.log("listening "+s.address().address+":"+s.address().port);
});

s.on("error", function (err) {
    console.log("server error:\n" + err.stack);
    s.close();
});

s.on('message', function(msg, rinfo){
  console.dir(msg);
  console.dir(rinfo);
});

s.bind(67, '0.0.0.0', function() {
  s.setMulticastTTL(255);
  s.addMembership('239.255.255.249', '192.168.119.1');
});
