/**
 * The sole purpose of this module is to use require() to import Node
 * built-in modules but expose them via ES Modules so Rollup is happy.
 */
const fs = require('fs');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

export { fs, http, readline, spawn };
