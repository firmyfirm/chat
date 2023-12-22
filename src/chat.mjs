export default {
  async fetch(request, env) {
    let url = new URL(request.url);
    let path = url.pathname.slice(1).split('/');
    if (!path[0]) {
      return new Response('Hello World', { headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }
    switch (path[0]) {
      case "api":
        return handleApiRequest(path.slice(1), request, env);
      default:
        return new Response("Not found", { status: 404 });
    }
  }
}

async function handleApiRequest(path, request, env) {
  let id = env.rooms.idFromName(path[0]);
  if (id == null) {
    id = env.rooms.idFromName(path[1]);
  }
  if (id == null) {
    id = env.rooms.newUniqueId();
    console.log("ID: ", id)
  }
  let roomObject = env.rooms.get(id);
  console.log("roomObject: ", roomObject)
  let newUrl = new URL(request.url);
  newUrl.pathname = "/" + path.join("/");
  console.log("newUrl: ", newUrl.pathname);
  return roomObject.fetch(newUrl, request);
}
export class ChatRoom {
  constructor(controller, env) {
    this.storage = controller.storage;
    this.env = env;
    this.sessions = [];
    this.lastTimestamp = 0;
  }
  async fetch(request) {
    let url = new URL(request.url);
    let path = url.pathname.slice(1).split('/');
    let ip = request.headers.get("CF-Connecting-IP");
    let limiterId = this.env.limiters.idFromName(ip);
    let limiter = new RateLimiterClient(
      () => this.env.limiters.get(limiterId));
    //,
    //  err => webSocket.close(1011, err.stack));
    let session = { ip, blockedMessages: [] };
    this.sessions.push(session);
    this.sessions.forEach(otherSession => {
      if (otherSession.name) {
        session.blockedMessages.push(JSON.stringify({ joined: otherSession.name }));
      }
    });
    let storage = await this.storage.list({ reverse: true, limit: 100 });
    let backlog = [...storage.values()];
    backlog.reverse();
    backlog.forEach(value => {
      session.blockedMessages.push(value);
    });
    let dataStr;
    
    try {
      if (session.quit) {
        return new Response("Session Closed", { status: 404 });
      }
      if (!limiter.checkLimit()) {
        return new Response("Rate Limit Reached", { status: 404 });
      }
     
      session.name = "" + ( path || "anonymous");
      let timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
      this.lastTimestamp = timestamp;
      let data = { source: path[0], destination: path[1], timestamp: timestamp };
      console.log(data);
      dataStr = JSON.stringify(data);
      let key = new Date(timestamp).toISOString();
      await this.storage.put(key, dataStr);
      
    } catch (err) {
    }
    return new Response(dataStr, { status: 200 });
  }
}
export class RateLimiter {
  constructor(controller, env) {
    this.nextAllowedTime = 0;
  }
  async fetch(request) {
    let now = Date.now() / 1000;
    this.nextAllowedTime = Math.max(now, this.nextAllowedTime);
    if (request.method == "POST") {
      this.nextAllowedTime += 5;
    }
    let cooldown = Math.max(0, this.nextAllowedTime - now - 20);
    return new Response(cooldown);
  }
}
class RateLimiterClient {
  constructor(getLimiterStub, reportError) {
    this.getLimiterStub = getLimiterStub;
    this.reportError = reportError;
    this.limiter = getLimiterStub();
    this.inCooldown = false;
  }
  checkLimit() {
    if (this.inCooldown) {
      return false;
    }
    this.inCooldown = true;
    this.callLimiter();
    return true;
  }
  async callLimiter() {
    try {
      let response;
      try {
        response = await this.limiter.fetch("https://dummy-url", { method: "POST" });
      } catch (err) {
        this.limiter = this.getLimiterStub();
        response = await this.limiter.fetch("https://dummy-url", { method: "POST" });
      }
      let cooldown = +(await response.text());
      await new Promise(resolve => setTimeout(resolve, cooldown * 1000));
      this.inCooldown = false;
    } catch (err) {
      this.reportError(err);
    }
  }
}
