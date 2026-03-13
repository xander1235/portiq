/**
 * Protocol System - Entry Point
 *
 * Registers all built-in protocols and exports the registry.
 * Third-party plugins can also register protocols via:
 *   import { ProtocolRegistry } from './protocols';
 *   ProtocolRegistry.register(myCustomProtocol);
 */

import { ProtocolRegistry } from "./registry.js";
import { HttpProtocol } from "./http.js";
import { GraphQLProtocol } from "./graphql.js";
import { WebSocketProtocol } from "./websocket.js";
import { GrpcProtocol } from "./grpc.js";

// Register all built-in protocols
ProtocolRegistry.register(HttpProtocol);
ProtocolRegistry.register(GraphQLProtocol);
ProtocolRegistry.register(WebSocketProtocol);
ProtocolRegistry.register(GrpcProtocol);

// Re-export everything for convenient access
export { ProtocolRegistry } from "./registry.js";
export { HttpProtocol } from "./http.js";
export { GraphQLProtocol } from "./graphql.js";
export { WebSocketProtocol } from "./websocket.js";
export { GrpcProtocol } from "./grpc.js";

export default ProtocolRegistry;
