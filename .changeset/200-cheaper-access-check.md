---
"@visonaut/web": patch
"@visonaut/security": patch
---

Cheaper access check for each private request

The access check of a signed-in request now does less work in D1 and sends fewer requests to GitHub:

- **No schema check on a request.** The sign-in library no longer compares the database schema with its own schema on each request. A test makes that comparison with the numbered migrations.
- **One statement for the session and its user.** The service reads both rows with one join.
- **The project read beside the session read.** A private API request reads the project row and the session at the same time. When the project configuration is wrong, the answer of the access check now comes before the answer of the project check.
- **A stored result after each live check.** A positive result of a live GitHub permission check, also of a write, serves later reads for at most 60 seconds and later Approve or Reject decisions for at most 10 seconds. Each other write still makes its own live check.
