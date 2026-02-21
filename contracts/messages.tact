// Trustless Agents — shared message definitions
//
// All inter-contract communication uses typed Tact messages routed
// through TON's native internal messaging.  No off-chain relayers,
// no event logs to poll — the contracts talk directly.

// Cross-contract agent verification

message VerifyAgent {
    agentId: Int as uint64;
    queryId: Int as uint64;
}

message VerifyAgentResponse {
    agentId: Int as uint64;
    queryId: Int as uint64;
    verified: Bool;
    agentAddress: Address;
}

// Identity

message RegisterAgent {}

message UpdateAgentAddress {
    agentId: Int as uint64;
    newAddress: Address;
}

// Reputation

message AcceptFeedback {
    agentClientId: Int as uint64;
    agentServerId: Int as uint64;
}

message CleanupPendingFeedback {
    queryId: Int as uint64;
}

// Validation

message RequestValidation {
    agentValidatorId: Int as uint64;
    agentServerId: Int as uint64;
    dataHash: Int as uint256;
    validatorAddress: Address;
}

message RespondValidation {
    dataHash: Int as uint256;
    response: Int as uint8;
}

message CleanupExpiredValidation {
    dataHash: Int as uint256;
}
