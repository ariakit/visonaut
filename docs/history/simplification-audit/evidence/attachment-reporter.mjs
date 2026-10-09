export default class Reporter {
  onBegin(config, suite) { this.suite = suite; }
  onEnd() {
    const tests = this.suite.allTests();
    let bodyBytes = 0;
    let bodies = 0;
    let files = 0;
    for (const test of tests) for (const result of test.results) for (const attachment of result.attachments) {
      if (attachment.body) { bodyBytes += attachment.body.byteLength; bodies++; }
      if (attachment.path) files++;
    }
    console.log(JSON.stringify({ mode: process.env.ATTACHMENT_MODE ?? 'body', testCount: tests.length, retainedAttachmentBodies: bodies, retainedBodyBytes: bodyBytes, fileAttachments: files, node: process.version, playwright: '1.63.0', note: 'Synthetic 1 MiB buffers, no browser or real screenshots; proves attachment retention, not production memory or timing.' }));
  }
}
