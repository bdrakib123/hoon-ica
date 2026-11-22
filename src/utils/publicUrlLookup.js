/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

"use strict";

const dns = require("node:dns");
const net = require("node:net");

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]) blocked.addSubnet(address, prefix, "ipv4");

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:30::", 28],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
]) blocked.addSubnet(address, prefix, "ipv6");

function isPublicAddress(address, family) {
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6 || !/^[23]/i.test(address)) return false;
  return !blocked.check(address, "ipv6");
}

// Pin every HTTP request (including redirects) to a DNS result that has been
// checked before the socket is opened. Reject mixed public/private answers too,
// so DNS rebinding cannot make a later address in the same response unsafe.
function createPublicLookup(resolve = dns.lookup) {
  return function publicLookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    options = options || {};
    resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!Array.isArray(addresses) || !addresses.length) {
        return callback(new Error("Attachment URL hostname did not resolve"));
      }
      if (addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) {
        return callback(new Error("Attachment URL resolves to a non-public IP address"));
      }
      let usable = addresses;
      if (options.family) usable = usable.filter((entry) => entry.family === options.family);
      if (!usable.length) return callback(new Error("Attachment URL has no address for the requested IP family"));
      if (options.all) return callback(null, usable);
      callback(null, usable[0].address, usable[0].family);
    });
  };
}

module.exports = { createPublicLookup, isPublicAddress };
