Debug memo: intermittent Polly/Lambda Function URL failures (Chrome)
Symptoms

Sometimes Speak works, sometimes it fails.

Chrome console may show CORS errors or random content_script.js errors.

Error may disappear when DevTools is open.

1. First rule: ignore extension noise unless it’s the only error

If you see:

content_script.js ... Cannot read properties of undefined (reading 'control')

A listener indicated an asynchronous response...

These are almost always Chrome extensions.
Action:

Retry in Incognito (extensions disabled), or disable form/autofill/AI/password extensions temporarily.

If the Lambda request still fails in Incognito → it’s not an extension issue.

2. If you see a CORS error, don’t stop at the console message

Console message:

No 'Access-Control-Allow-Origin' header...

This can happen even when the real problem is that Lambda returned 500/502, and the browser reports it as CORS.

What to check

Open DevTools → Network, click the request to the Function URL, then record:

Status Code (200 / 500 / 502)

Response Headers: is access-control-allow-origin present?

Request Headers: what is the Origin exactly? (example: http://localhost:8081)

3. Fast verification with curl (best truth source)

Run:

curl -i -H "Origin: http://localhost:8081" \
"https://5lnh2x4pkd5grdowzvb7bgugha0timkl.lambda-url.ap-southeast-2.on.aws/?text=Hello&voiceId=Joanna&format=mp3&engine=neural"

Interpretation:

If you get HTTP 200 and access-control-allow-origin in headers → CORS is basically fine.

If you get HTTP 500/502 → it’s a Lambda/server issue (not CORS).

Optional preflight simulation:

curl -i -X OPTIONS \
 -H "Origin: http://localhost:8081" \
 -H "Access-Control-Request-Method: GET" \
"https://5lnh2x4pkd5grdowzvb7bgugha0timkl.lambda-url.ap-southeast-2.on.aws/"

4. Lambda-side check when status is 500/502

Go to CloudWatch Logs for the latest request and look for:

errorType

errorMessage

stack trace

If it’s a “syntax error” / “unexpected token” → wrong runtime/source format (JS vs TS) or build artifact issue.
If it’s permission/network errors → IAM policy / AWS SDK/Polly permission issue.

5. One common trap

If your Lambda handler returns an OPTIONS response with no CORS headers, browsers may fail preflight intermittently depending on request mode/caching.

So if it reappears:

Verify preflight (OPTIONS) with the curl command above.

Ensure either:

Function URL CORS handles it fully, or

your code always adds CORS headers on OPTIONS and errors.

Quick “repro checklist” (copy/paste)

When it fails again, capture:

Network tab screenshot of the failing request (status + headers)

Output of curl -i command above

CloudWatch errorType + errorMessage (if status 500/502)

Access to fetch at 'https://5lnh2x4pkd5grdowzvb7bgugha0timkl.lambda-url.ap-southeast-2.on.aws/?text=hi&voiceId=Joanna&format=mp3&engine=neural&tone=healing' from origin 'http://localhost:8081' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.このエラーを分析
5lnh2x4pkd5grdowzvb7bgugha0timkl.lambda-url.ap-southeast-2.on.aws/?text=hi&voiceId=Joanna&format=mp3&engine=neural&tone=healing:1 Failed to load resource: net::ERR_FAILED このエラーを分析
（インデックス）:1 Access to fetch at 'https://5lnh2x4pkd5grdowzvb7bgugha0timkl.lambda-url.ap-southeast-2.on.aws/?text=hi&voiceId=Joanna&format=mp3&engine=neural&tone=healing' from origin 'http://localhost:8081' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.このエラーを分析
5lnh2x4pkd5grdowzvb7bgugha0timkl.lambda-url.ap-southeast-2.on.aws/?text=hi&voiceId=Joanna&format=mp3&engine=neural&tone=healing:1 Failed to load resource: net::ERR_FAILED
