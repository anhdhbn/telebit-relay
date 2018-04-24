#!/usr/bin/env node
'use strict'

console.log(require('crypto').randomBytes(16).toString('hex'));
