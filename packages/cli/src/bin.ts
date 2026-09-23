#!/usr/bin/env node
import { runCli } from "./index.js";

process.exitCode = await runCli({ argv: process.argv.slice(2) });
