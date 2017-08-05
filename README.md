# X2 Framework for Node.js | RESTful Web Services

This is _X2 Farmework_'s module that provides foundation for building server-sive applications that expose RESTful APIs. The main purpose of the module is to provide the core that sits between the basic _Node.js_ HTTP server functionality and custom application code responsible for processing the web service API calls. The core implements the most common web service functionality and maps incoming HTTP requests to the application-supplied handlers. It includes hooks for request authenticators and authorizers, CORS, support for multipart responses with streaming data, extraction of parameters from request URIs, marshalling and unmarshalling data, responding to the HTTP `OPTIONS` method requests, and other web service basics.

See module's [API Reference Documentation](https://boylesoftware.github.io/x2node-api-reference/module-x2node-ws.html).

This is a low-level module. For higher level web service building functionality see [x2node-ws-resources](https://www.npmjs.com/package/x2node-ws-resources) module.

## Table of Contents

* [Usage](#usage)
* [Application Configuration](#application-configuration)
* [Endpoints](#endpoints)
  * [Service Call](#service-call)
  * [Service Response](#service-response)
  * [Call Authorization](#call-authorization)
  * [The OPTIONS Method](#the-options-method)
* [Authenticators](#authenticators)
  * [Actors Registry](#actors-registry)
  * [Basic Authenticator](#basic-authenticator)
  * [JWT Authenticator](#jwt-authenticator)
* [Authorizers](#authorizers)
* [Marshallers](#marshallers)
* [Terminating Application](#terminating-application)

## Usage

The web service is represented by an `Application` object created by the module's `createApplication()` function. The application is configured by adding custom endpoint handlers mapped to request URIs using regular expressions. In addition to the endpoints, the application can also include mappings for request authenticators and authorizers. Here is a simple example:

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

This little app will listen on the HTTP port 3001 and will response with a simple JSON object to HTTP `GET` request sent to either of the two endpoints. For example, for request:

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

And for an invalid URI request:

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

## Application Configuration

The module's `createApplication()` function that builds and returns the runnable `Application` object can optionally take an object with the application options. The options include:

* `apiVersion` - Version of the API exposed by the application. If not specified, the version is determined automatically using the following logic: The `NODE_ENV` environment variable is examined. If its value is "development", the version is set to the current timestamp so that it changes each time the application is restarted. Otherwise, the version is read from the main module's `package.json`.

* `connectionIdleTimeout` - Timeout in milliseconds for inactivity on the HTTP connection when activity is expected from the client (waiting for the request, reading the request body, accepting the server response). If the timeout occurs before the server starts sending the response, an HTTP 408 (Request Timeout) response is sent back to the client and the connection is closed. If timeout happens after the response headers have been sent, the connection is quitely closed. The default is 30 seconds.

* `maxRequestHeadersCount` - Maximum allowed number of incoming HTTP request headers. The default is 50. This corresponds to the _Node.js_ HTTP module's [maxHeadersCount](https://nodejs.org/docs/latest-v4.x/api/http.html#http_server_maxheaderscount) parameter.

* `maxRequestSize` - Maximum allowed size of request payload in bytes. If exceeded, an HTTP 413 (Payload Too Large) response is send back to the client. The default is 2048.

* `allowedOrigins` - This is used to configure the [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Access_control_CORS). The option is a list (comma-separated string or an array) of allowed CORS origins (e.g. `http://www.example.com`, etc.). If the front-end application that calls the web service is only available from certain specific URLs, it is recommended to configure the CORS to make certain types of attacks, such as CSRF, harder. If not provided, the default is to allow any origin.

* `corsPreflightMaxAge` - Part of CORS configuration, maximum age in seconds for caching CORS preflight responses on the client (see "Access-Control-Max-Age" HTTP response header). The default is 20 days.

The options object is also made available to the application via the `ServiceCall` object's `appOptions` property (described below), so it can be used for custom application options as well.

Once the `Application` object is created, the following methods are used to configure the web service:

* `addEndpoint(uriPattern, handler)` - Define the API endpoint. The method associates the application-supplied `handler` with request URIs that match the `uriPattern`, which is a regular expression (as a string!). The regular expression is applied to the whole URI, so there is no need to use `^` and `$` pattern characters. Also, the expression may contain capturing groups, which become positional URI parameters extracted by the framework from the request URI and provided to the handler when it is invoked. The endpoints are matched in the order they were added to the `Application` object, which prevents ambiguity in the endpoint selection logic when URI patterns overlap. The detailed discussion of the application-supplied handlers is provided in the [Endpoints](#endpoints) section.

* `addAuthenticator(uriPattern, authenticator)` - Associate an authenticator with the request URI pattern. Authenticators are responsible for associating actors (see [x2node-common](https://www.npmjs.com/package/x2node-common) module) with requests and are described in detail in the [Authenticators](#authenticators) section. As with the endpoints, the authenticators are matched in the order they are added (however, normally, an application would have only a single authenticator covering all the endpoints using `uriPattern` like "/.*"). If no authenticators are added to the application, all requests are processed as unauthenticated (i.e. anonymous).

* `addAuthorizer(uriPattern, authorizer)` - Associate an authorizer with the request URI pattern. Authorizers are responsible for making the decision whether the authenticated actor is allowed to perform the request or not. It is described in detail in the [Authorizers](#authorizers) section. The `authorizer` argument can be a function, in which case it is used as the authorizer's `isAllowed()` method. As opposed to the endpoints and authenticators, multiple authorizers can match the same URI and they are all called in a sequence rather than only one of them. They are called in the order they were added to the `Application` object. If no authorizers are added to the application, all requests are passed to the endpoint handlers without any pre-authorization.

* `addMarshaller(contentTypePattern, marshaller)` - Associate a marshaller implementation with a request/response content type. Marshallers are responsible for converting HTTP request and response entities to and from JavaScript objects. The `contentTypePattern` regular expression (must be supplied as a string!) is matched against the content type as a whole and in a case-insensitive mode. The content type is used without any parameters (such as `charset`, etc.). Patterns are matched in the order they were added to the application and the first one matched is used. After the application adds (or doesn't add) all of its custom marshallers, the framework automatically adds a default implemention of the JSON marshaller and associats it with content types "application/json" and anything with a "+json" suffix (see [RFC 6839](https://tools.ietf.org/html/rfc6839)). If a request is received with payload and "Content-Type" header, for which the application does not have a marshaller, it responds with an HTTP 415 (Unsupported Media Type) response. See [Marshallers](#marshallers) section for information on how to add custom marshallers for other content types.

Once the `Application` object is completely configured, it can be started using its `run()` method. The method takes a single argument, which is the HTTP port, on which the application will be listening for the incoming requests. The method ultimately ends up calling standard _Node.js_ HTTP server [listen()](https://nodejs.org/docs/latest-v4.x/api/http.html#http_server_listen_port_hostname_backlog_callback) method.

## Endpoints

The web service API is represented by the _endpoints_. An API endpoint is a specific HTTP request URI pattern and a collection of HTTP request methods that can be sent to it. The endpoint call processing logic is implemented in the _endpoint handler_. The handlers are where the most of the application logic is coded.

Handlers are associated with URI patterns to create API endpoints using `Application` object's `addEndpoint(uriPattern, handler)` method. For every HTTP method that the handler supports, it has a method with the HTTP method's name, all caps (e.g. `GET()`, `POST()`, etc.). If a request is sent to the endpoint using an HTTP method not supported by the handler, an HTTP 405 (Method Not Allowed) response is sent back to the client. Otherwise, the corresponding method on the handler is called and it return value is used to create the HTTP response.

### Service Call

The methods on the handler receive a `ServiceCall` object as its only argument. The `ServiceCall` exposes the following properties:

* `id` - A string representing the unique id of the service call. The id is unique within the service process and can be used to identify requests.

* `timestamp` - The timestamp when the call was received. `Date.now()` is used to get the timestamp.

* `apiVersion` - Application API version (see `apiVersion` application configuration option).

* `appOptions` - Application configuration options originally passed to the module's `createApplication()` function, or an empty object if none were passed.

* `httpRequest` - The original _Node.js_ [http.IncomingMessage](https://nodejs.org/docs/latest-v4.x/api/http.html#http_class_http_incomingmessage) representing the HTTP request.

* `method` - The request method, all caps. This is a shortcut for `httpRequest.method`.

* `requestUrl` - Fully parsed request URL represented by a _Node.js_ [Url](https://nodejs.org/docs/latest-v4.x/api/url.html) object. The query string is parsed.

* `authenticator` - The authenticator used to authenticate the request, if any. This is the authenticator added to the `Application` via its `addAuthenticator()` method and matched against the request URI.

* `authorizers` - Array of authorizers used for the call, if any. These are the authorizers added to the `Application` via its `addAuthorizer()` method.

* `handler` - The handler (which is also going to be `this` in the handler method call).

* `uriParams` - If the URI pattern passed to the `addEndpoint()` method has capturing groups, the extracted from the request URI group values are stored in this string array and passed to the handler.

* `actor` - The actor associated with the call, or `null` if unauthenticated. Note, that this is a read-write property. If the handler sets a new actor to the `ServiceCall` object, the authenticator may pick it up and adjust the response accordingly.

* `authorized` - A Boolean flag that tells if the call was authorized. By the time the call object is passed to the handler, the flag is going to be `true`.

* `entity` - An object with the unmarshalled request payload, or `null` if none.

* `entityContentType` - If `entity` is present, this is the request payload content type (all lower-case, stripped of any parameters such as "charset").

### Service Response

Upon completion, the handler method may return one of the following:

* A `null`, in which case an HTTP 204 (No Content) response is sent back to the client.

* An object, in which case it is serialized into JSON and is sent back to the client in an HTTP 200 (OK) response payload.

* A `ServiceResponse` object created via the module's `createResponse()` function described below.

* Anything else, in which case it is converted into a string and is sent back to the client as "text/plain" content type in an HTTP 200 (OK) response payload.

* A `Promise` of anything of the above. If the promise is rejected with a `ServiceResponse` object, that's the response that gets sent back to the client. If it is rejected with anything else, an HTTP 500 (Internal Server Error) is send back to the client.

The most specific way of creating a service call response is by using the module's `createResponse()` function. The function takes a single argument with the HTTP response status code. The `ServiceResponse` object that it returns exposes the following properties and methods:

* `setHeader(name, value)` - Add header to the HTTP response. Any previously set header is replaced. The header name is identified by the `name` argument and is case-insensitive. If the value is an instance of `Date`, it is automatically formatted (using `Date.toUTCString()`).

* `addToHeadersListHeader(name, value)` - Add value(s) to an HTTP response header that is a list of other header names. Examples of such headers are "Vary", "Access-Control-Allow-Headers" and "Access-Control-Expose-Headers". The method checks if the headers are already present in the current value and does not add them twice. The header name is specified by the `name` argument and is case-insensitive. The `value` can be a string or an array of strings. The case of the header names in the `value` is also case-insensitive (automatically normalized by the method).

* `addToMethodsListHeader(name, value)` - Add value(s) to an HTTP response header that is a list of HTTP methods. Examples of such headers are "Allow" and "Access-Control-Allow-Methods". The method checks if the methods are already present in the current value and does not add them twice. The header name is specified by the `name` argument and is case-insensitive. The `value` can be a string or an array of strings. The case of the method names in the `value` is also case-insensitive (automatically normalized by the method).

* `setEntity(data, [contentType])` - Add main entity to the HTTP response (any previously set entity is replaced). The entity data specified by `data` argument can be one of the following:

  * An object, in which case it is serialized using a marshaller associated with the specified `contentType`. Custom marshallers can be registered on the `Application` via its `addMarshaller()` method.

  * A _Node.js_ [Buffer](https://nodejs.org/docs/latest-v4.x/api/buffer.html), in which case the buffer's binary data is sent in the response body.

  * A _Node.js_ [stream.Readable](https://nodejs.org/docs/latest-v4.x/api/stream.html#stream_class_stream_readable). If used, the response is sent using "chunked" transfer encoding (see HTTP specification's [Chunked Transfer Coding](https://tools.ietf.org/html/rfc7230#section-4.1)).

  If the `contentType` argument is not provided, "application/json" is assumed.

* `addAttachment(data, [contentType], [filename])` - Add attachment to the HTTP response sent back to the client in the response payload. The attachments are semantically different from the main response entity set by the `setEntity()` method. Multiple attachments can be added to the response with or without the main entity (although normally with). If a response ends up having an entity and attachments or just more than a single attachment, the HTTP response is sent with content type "multipart/mixed". The parts are included in the response payload in the order they were added with the main entity, if any, always first. As with the `setEntity()` method, the `data` can be an object, a buffer or a stream. The default `contentType` is "application/json" and providing a `filename` argument will include "Content-Disposition" response header with the specified "filename" parameter.

* `statusCode` - The HTTP response status code.

* `hasHeader(name)` - Returns `true` if the specified response header is present on the response. The `name` argument is case-insensitive.

* `headers` - HTTP response headers present on the response. The property is an object with keys being all lower case header names and the values being strings with the corresponding header values.

* `entities` - An array of the HTTP response entity and the attachments in the correct order, or an empty array if none. Each array element is an object that includes a `headers` property (same format as the `headers` property of the response object) and a `data` property, which is an object, a buffer or a stream.

All of the response construction `addXXX()` and `setXXX()` methods return the response object itself for chaining.

The `x2node-ws` module, in addition to the `createResponse()` function, also exposes a function called `isResponse()`. It takes an object as its single argument and returns `true` if the provided object is a `ServiceResponse`.

### Call Authorization

An enpoint handler can provide an optional method called `isAllowed()`, which is called by the framework before any service call is forwarded to the main processing method to give the handler an early chance to check if the actor associated with the call is allowed to perform it. The method, if defined, receives the `ServiceCall` object as its only argument with the `actor` property set. The method returns a Boolean or a `Promise` of it. If it is `true`, the call is forwarded to the endpoint handler's main call processing method. If it is `false`, the call is aborted and the client gets either an HTTP 401 (Unauthorized) response if the request is not authenticated (`actor` property on the call is `null`) or an HTTP 403 (Forbidden) response if it is.

### The OPTIONS Method

The `OPTIONS` handler method, if present, is special. The framework takes care of responding to the `OPTIONS` requests on its own, but before sending the response it can give the handler a chance to participate in building the response if it defines an `OPTIONS` method. As opposed to the normal HTTP method handler methods, the `OPTIONS` method receives two arguments: the `ServiceCall` and the `ServiceResponse`. It can add headers to the provided `ServiceResponse`, if it needs to, and the return value of the method is ignored.

## Authenticators

Before the call is passed to the matching endpoint handler, it is passed to an authenticator addded to the `Application` using its `addAuthenticator()` method. The authenticator is responsible to identifying the actor making the call and setting it to the `ServiceCall.actor` property. The authenticator has the following interface:

* `authenticate(call)` - Method called by the framework to authenticate the call. The `call` argument is an instance of `ServiceCall`. The method returns an actor object, a `null` if the call cannot be authenticated, or a `Promise` of the above.

* `addResponseHeaders(call, response)` - An optional method that an authenticator can have if it needs to add headers to the HTTP response. The method is called whenever the framework is sending an HTTP response after the call has been passed through the `authenticate()` method. The `call` argument is an instance of `ServiceCall` and the `response` argument is an instance of `ServiceResponse`.

### Actors Registry

The task of request authentication has two distinctive parts: extracting the authentication information such as the caller handle and credentials from the request (e.g. from the HTTP request headers) and then looking up the actor in some sort of a user database. Two decouple the task of the actor lookup from the authenticator the framework introduces an `ActorsRegistry` interface. The interface includes one single method:

* `lookupActor(handle, [creds])` - Lookup the actor in the actor registry. The actor is identified by the string argument `handle`, which is the actor handle (user id, login name, etc.) extracted by the authenticator from the request. Optionally, if the authentication scheme and the actors registry include it, the second string argument `creds` is the actor credentials (for example password) also extracted by the authenticator from the request. The method returns a `Promise` of an `Actor` object. If the promise is fulfilled with `null`, no valid actor with the specified handle and credentials exist.

The authenticators do not have to use the actor registries, but it is a recommended practice.

### Basic Authenticator

The `x2node-ws` module includes an authenticator implementation for the "Basic" scheme (see [RFC 7617](https://tools.ietf.org/html/rfc7617)). The authenticator class is exported by the module as `BasicAuthenticator`. The constructor takes two arguments: the actors registry (an implementation of the `ActorsRegistry` interface) and an optional authentication realm with the default value of "Web Service". For example:

```javascript
const ws = require('x2node-ws');

ws.createApplication()
    .addAuthenticator('/.*', new ws.BasicAuthenticator({
        lookupActor(loginName, password) {
            if ((loginName === 'myuser') && (password === 'mypassword'))
                return Promise.resolve({
                    stamp: 'myuser',
                    hasRole: () => true
                });
            return Promise.resolve(null);
        }
    }, 'My Service'))
    // configure the rest of the web service
    // ...
    .run(3001);
```

Note the use of a dummy actors registry implementation. Such implementations are often useful for testing and development environments.

### JWT Authenticator

A JWT-based authenticator implementation (for OAuth 2.0, etc.) is provided by the [x2node-ws-auth-jwt](https://www.npmjs.com/package/x2node-ws-auth-jwt) module.

## Authorizers

An individual endpoint handler can have an `isAllowed()` method where it makes the decision if the authenticated actor is authorized to make the call or not. However, often the same call authorization logic is applied across a whole bunch of endpoints. Instead of replicating the same logic in every handler, the application can register an `Authorizer` for a URI pattern that covers all the protected endpoints using the `Application` object's `addAuthorizer()` method. The first argument of the method is the URI pattern and the second argument is an implementation of the `Authorizer` interface, which includes a single `isAllowed()` method defined the same way as the one on the endpoint handler:

* `isAllowed(call)` - Tell if the specified by the `call` argument `ServiceCall` is allowed to be performed by the actor in the `ServiceCall.actor` property. The method can return a Boolean or a `Promise` of it. If it is `true`, the call is forwarded further to other matching authorizers and utlimately to the endpoint handler. If it is `false`, no other authorizers are called, no handler is called, and the client gets either an HTTP 401 (Unauthorized) response if the request is not authenticated or an HTTP 403 (Forbidden) response if it is.

The second argument of the `addAuthorizer()` method can be also a function, in which case it used as the authorizer's `isAllowed()` method.

As opposed to the authenticators and endpoint handlers, multiple authorizers can be matched against a request URI. If so, they are called in a sequence in the same order as they were added to the `Application` object. If the handler also has an `isAllowed()` method, it is called last. Only if all the authorizers in the chain and the handler's `isAllowed()` method, if any, tell that the call is allowed, the call is forwarded further to the endpoint handler's main call processing method.

## Marshallers

Marshallers are used to deserialize (unmarshal) HTTP request entities into JavaScript objects and to serialize (marshal) JavaScript objects into HTTP response entities. Marshallers are associated with content types (values of the "Content-Type" HTTP header). By default, the `Application` includes a JSON marshaller associated with "application/json" conent type and anything with a "+json" suffix. A custom marshaller can be added to the `Application` object using its `addMarshaller()` method. The method takes two arguments: the content type regular expression pattern and an implementation of the `Marshaller` interface, which includes two methods:

* `serialize(obj, contentType)` - Serialize the specified by the `obj` argument object into the binary data for the specified `contentType`. The `contentType` argument may include an optional "charset" parameter. The method returns a _Node.js_ [Buffer](https://nodejs.org/docs/latest-v4.x/api/buffer.html) object with the serialized data.

* `deserialize(data, contentType)` - Deserialize the [Buffer](https://nodejs.org/docs/latest-v4.x/api/buffer.html) provided as the `data` argument into a JavaScript object using the specified `contentType`. The `contentType` argument may include an optional "charset" parameter. The method returns the deserialized object. If the binary data in the buffer is invalid and cannot be deserialized, the method must throw an `X2DataError` (see [x2node-common](https://www.npmjs.com/package/x2node-common) module).

## Terminating Application

Once the `Application` object's `run()` method is called, _Node.js_ process will keep running and listening to the incoming requests on the specified TCP port. To stop the web service application, either of the following signals can be sent to it: `SIGHUP`, `SIGINT` (the Ctrl+C), `SIGTERM` (standard system signal used to terminate background processes) or `SIGBREAK` (Ctrl+Break on _Windows_).

The `Application` object is an [EventEmitter](https://nodejs.org/docs/latest-v4.x/api/events.html#events_class_eventemitter), which emits a "shutdown" signal when the HTTP server closes all the connections. This allows to gracefully shutdown any application internal services, such as, for example, database connection pools:

```javascript
const mysql = require('mysql');
const ws = require('x2node-ws');

const pool = mysql.createPool({
    connectionLimit: 5,
    host: process.env['DB_HOST'],
    port: process.env['DB_PORT'] || 3306,
    database: process.env['DB_NAME'],
    user: process.env['DB_USER'],
    password: process.env['DB_PASSWORD'],
    timezone: '+00:00'
});

ws.createApplication()
    .on('shutdown', () => {
        pool.end();
    })
    // configure the rest of the application
    // ...
    .run(Number(process.env['HTTP_PORT']));
```
