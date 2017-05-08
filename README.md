# X2 Framework for Node.js | RESTful Web Services

This is X2 Farmework's module that provides foundation for building server-sive applications that expose RESTful APIs. The main purpose of the module is to provide the core that sits between the basic Node.js HTTP server functionality and custom application code responsible for processing the web service API calls. The core implements the most common web service functionality and maps incoming HTTP requests to the application-supplied handlers. It includes hooks for request authenticators and authorizers, CORS, support for multipart responses with streaming data, extraction of parameters from request URIs, marshalling and unmarshalling data, and other web service basics.

See module's [API Reference Documentation](https://boylesoftware.github.io/x2node-api-reference/module-x2node-ws.html).

## Table of Contents

TODO

## Usage

The web service is represented by the _application_ object created by the module's `createApplication()` function. The application is configured by adding custom endpoint handlers mapped to request URIs using regular expressions. In addition to the endpoints, the application can also include mappings for request authenticators and authorizers. Here is a simple example:

```javascript
const ws = require('x2node-ws');

ws.createApplication()
    .addEndpoint('/sayhello', {
        GET() {
            return {
                message: "Well Hallo to you!"
            };
        }
    })
    .addEndpoint('/saygoodbye', {
        GET() {
            return {
                message: "OK, bye bye!"
            };
        }
    })
    .run(3001);
```

This little app will listen on the HTTP port 3001 and will response with a simple JSON object to HTTP GET request sent to the two endpoints. For example, for request:

```http
GET /sayhello HTTP/1.1
Host: localhost:3001
Accept: application/json
```

the response will be:

```http
HTTP/1.1 200 OK
Vary: Origin
Cache-Control: no-cache
Expires: 0
Pragma: no-cache
Content-Type: application/json
Content-Length: 32
Date: Mon, 08 May 2017 21:53:21 GMT
Connection: keep-alive

{
    "message": "Well Hallo to you!"
}
```

And for:

```http
GET /invalid HTTP/1.1
Host: localhost:3001
Accept: application/json
```

it will be:

```http
HTTP/1.1 404 Not Found
Vary: Origin
Cache-Control: no-cache
Expires: 0
Pragma: no-cache
Content-Type: application/json
Content-Length: 74
Date: Mon, 08 May 2017 21:54:30 GMT
Connection: keep-alive

{
    "errorCode": "X2-404-1",
    "errorMessage": "No service endpoint at this URI."
}
```

The module uses `X2_APP` section for debug logging. Add it to `NODE_DEBUG` environment variable to see the debug messages (see [Node.js API docs](https://nodejs.org/docs/latest-v4.x/api/util.html#util_util_debuglog_section) for details).

## Endpoints

TODO

## Authenticators

TODO

## Authorizers

TODO

## Application Configuration

TODO

**WORK IN PROGRESS, MANUAL WILL BE PUBLISHED UPON RELEASE**
