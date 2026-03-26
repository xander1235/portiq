/**
 * Protocol System - Entry Point
 *
 * Registers all built-in protocols and exports the registry.
 * Third-party plugins can also register protocols via:
 *   import { ProtocolRegistry } from './protocols';
 *   ProtocolRegistry.register(myCustomProtocol);
 */

import { ProtocolRegistry } from "./registry";
import { HttpProtocol } from "./http";
import { GraphQLProtocol } from "./graphql";
import { WebSocketProtocol } from "./websocket";
import { GrpcProtocol } from "./grpc";

// Register all built-in protocols
ProtocolRegistry.register(HttpProtocol);
ProtocolRegistry.register(GraphQLProtocol);
ProtocolRegistry.register(WebSocketProtocol);
ProtocolRegistry.register(GrpcProtocol);

// Re-export everything for convenient access
export { ProtocolRegistry } from "./registry";
export { HttpProtocol } from "./http";
export { GraphQLProtocol } from "./graphql";
export { WebSocketProtocol } from "./websocket";
export { GrpcProtocol } from "./grpc";

export default ProtocolRegistry;
