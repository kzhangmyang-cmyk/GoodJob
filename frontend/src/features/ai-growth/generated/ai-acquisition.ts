export interface paths {
    "/api/v1/ai/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List model providers */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cursor-paginated result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PagedResult"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ai/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List model connections */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cursor-paginated result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PagedResult"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        /** Create model connection */
        post: {
            parameters: {
                query?: never;
                header: {
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Model connection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["model-connection.v1.schema"];
                    };
                };
                /** @description Unified API error */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ai/connections/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["id"];
            };
            cookie?: never;
        };
        /** Get model connection */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Model connection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["model-connection.v1.schema"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /** Delete model connection */
        delete: {
            parameters: {
                query?: never;
                header: {
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path: {
                    id: components["parameters"]["id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": Record<string, never>;
                    };
                };
                /** @description Unified API error */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Connection is retained by active tasks or audit policy */
                409: {
                    headers: {
                        "X-Error-Code": "connection_in_use";
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /** Update model connection */
        patch: {
            parameters: {
                query?: never;
                header: {
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path: {
                    id: components["parameters"]["id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Model connection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["model-connection.v1.schema"];
                    };
                };
                /** @description Unified API error */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/ai/connections/{id}/models": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["id"];
            };
            cookie?: never;
        };
        /** List supported models */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header?: never;
                path: {
                    id: components["parameters"]["id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cursor-paginated result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PagedResult"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ai/connections/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["id"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test model connection */
        post: {
            parameters: {
                query?: never;
                header: {
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path: {
                    id: components["parameters"]["id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Accepted asynchronous operation */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["async-operation.v1.schema"];
                    };
                };
                /** @description Unified API error */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ai/connections/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["id"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate model connection */
        post: {
            parameters: {
                query?: never;
                header: {
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path: {
                    id: components["parameters"]["id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Model connection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["model-connection.v1.schema"];
                    };
                };
                /** @description Unified API error */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ai/calls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List model call records */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cursor-paginated result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PagedResult"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ai/calls/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["id"];
            };
            cookie?: never;
        };
        /** Get model call record */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Model call record */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["model-call-record.v1.schema"];
                    };
                };
                /** @description Unified API error */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List discovery providers */
        get: operations["listAcquisitionProviders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/provider-connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List provider connections */
        get: operations["listAcquisitionProviderConnections"];
        put?: never;
        /** Create provider connection */
        post: operations["createAcquisitionProviderConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/provider-connections/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** Get provider connection */
        get: operations["getAcquisitionProviderConnection"];
        put?: never;
        post?: never;
        /** Delete provider connection */
        delete: operations["deleteAcquisitionProviderConnection"];
        options?: never;
        head?: never;
        /** Update provider connection */
        patch: operations["updateAcquisitionProviderConnection"];
        trace?: never;
    };
    "/api/v1/acquisition/provider-connections/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test provider connection */
        post: operations["testAcquisitionProviderConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/content-fetch-operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List content fetch operations */
        get: operations["listAcquisitionContentFetchOperations"];
        put?: never;
        /** Create content fetch operation */
        post: operations["createAcquisitionContentFetchOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/content-fetch-operations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** Get content fetch operation */
        get: operations["getAcquisitionContentFetchOperation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/import-operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List import operations */
        get: operations["listAcquisitionImportOperations"];
        put?: never;
        /** Create import operation */
        post: operations["createAcquisitionImportOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/import-operations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** Get import operation */
        get: operations["getAcquisitionImportOperation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/evidence/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** Get discovery evidence */
        get: operations["getAcquisitionEvidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create acquisition plan */
        post: operations["createAcquisitionPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/plans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** Get acquisition plan */
        get: operations["getAcquisitionPlan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update acquisition plan */
        patch: operations["updateAcquisitionPlan"];
        trace?: never;
    };
    "/api/v1/acquisition/plans/{id}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create acquisition plan revision */
        post: operations["createAcquisitionPlanRevision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/plans/{id}/approval": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve acquisition plan */
        post: operations["approveAcquisitionPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/plans/{id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create acquisition run */
        post: operations["createAcquisitionRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** Get acquisition run */
        get: operations["getAcquisitionRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/runs/{id}/shards": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** List acquisition run shards */
        get: operations["listAcquisitionRunShards"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/runs/{id}/presentation": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** Get acquisition run presentation */
        get: operations["getAcquisitionRunPresentation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/runs/{id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause acquisition run */
        post: operations["pauseAcquisitionRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/runs/{id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume acquisition run */
        post: operations["resumeAcquisitionRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/runs/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel acquisition run */
        post: operations["cancelAcquisitionRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List candidates */
        get: operations["listAcquisitionCandidates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** Get candidate */
        get: operations["getAcquisitionCandidate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** List candidate evidence */
        get: operations["listAcquisitionCandidateEvidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/identity-confirmation": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm candidate identity */
        post: operations["confirmAcquisitionCandidateIdentity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{candidateId}/intelligence-operations": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidateId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create candidate intelligence operation */
        post: operations["createAcquisitionCandidateIntelligenceOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidate-intelligence-operations/{operationId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operationId: string;
            };
            cookie?: never;
        };
        /** Get candidate intelligence operation */
        get: operations["getAcquisitionCandidateIntelligenceOperation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{candidateId}/intelligence-operation": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidateId: string;
            };
            cookie?: never;
        };
        /** Get latest candidate intelligence operation */
        get: operations["getLatestAcquisitionCandidateIntelligenceOperation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidate-intelligence-operations/{operationId}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operationId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retry candidate intelligence operation */
        post: operations["retryAcquisitionCandidateIntelligenceOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/qualification": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** Get qualification decision */
        get: operations["getAcquisitionCandidateQualification"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/financial-value": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** Get financial value decision */
        get: operations["getAcquisitionCandidateFinancialValue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/battle-card": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** Get battle card */
        get: operations["getAcquisitionCandidateBattleCard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/reviews": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** List review events */
        get: operations["listAcquisitionCandidateReviews"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Review candidate */
        post: operations["reviewAcquisitionCandidate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/candidates/{id}/convert": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Convert candidate */
        post: operations["convertAcquisitionCandidate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/outcomes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List outcome feedback */
        get: operations["listAcquisitionOutcomes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/performance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read acquisition funnel, currency-separated contract values, and owner briefing facts */
        get: operations["getAcquisitionPerformance"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/copilot/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create copilot session */
        post: operations["createAcquisitionCopilotSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/copilot/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** Get copilot session */
        get: operations["getAcquisitionCopilotSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/copilot/sessions/{id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** List copilot messages */
        get: operations["listAcquisitionCopilotMessages"];
        put?: never;
        /** Send copilot message */
        post: operations["sendAcquisitionCopilotMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/copilot/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        /** Get copilot task */
        get: operations["getAcquisitionCopilotTask"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acquisition/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List audit events */
        get: operations["listAcquisitionAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AsyncOperation: components["schemas"]["async-operation.v1.schema"];
        ApiError: {
            code: string;
            message: string;
            details: unknown;
            requestId: string;
            retryable: boolean;
        } | {
            error: {
                code: string;
                message: string;
                details?: unknown;
                requestId?: string;
            };
        };
        PagedResult: {
            items: Record<string, never>[];
            nextCursor: string | null;
        };
        ModelProvider: components["schemas"]["model-provider.v1.schema"];
        ModelConnection: components["schemas"]["model-connection.v1.schema"];
        ModelCallRecord: components["schemas"]["model-call-record.v1.schema"];
        DiscoveryProvider: components["schemas"]["discovery-provider.v1.schema"];
        ProviderConnection: components["schemas"]["provider-connection.v1.schema"];
        ContentFetchOperation: components["schemas"]["content-fetch-operation.v1.schema"];
        ContentFetchOperationList: {
            items: components["schemas"]["content-fetch-operation.v1.schema"][];
        };
        ImportOperation: components["schemas"]["import-operation.v1.schema"];
        ImportOperationList: {
            items: components["schemas"]["import-operation.v1.schema"][];
        };
        CandidateIntelligenceOperation: components["schemas"]["candidate-intelligence-operation.v1.schema"];
        AcquisitionPlan: components["schemas"]["acquisition-plan.v1.schema"];
        AcquisitionRun: components["schemas"]["acquisition-run.v1.schema"];
        AcquisitionOperationShard: components["schemas"]["acquisition-operation-shard.v1.schema"];
        AcquisitionRunPresentation: components["schemas"]["acquisition-run-presentation.v1.schema"];
        OrganizationCandidate: components["schemas"]["organization-candidate.v1.schema"];
        IndividualDemandSignal: components["schemas"]["individual-demand-signal.v1.schema"];
        Candidate: components["schemas"]["organization-candidate.v1.schema"] | components["schemas"]["individual-demand-signal.v1.schema"];
        CandidatePagedResult: {
            items: components["schemas"]["Candidate"][];
            nextCursor: string | null;
        };
        DiscoveryEvidence: components["schemas"]["discovery-evidence.v1.schema"];
        QualificationDecision: components["schemas"]["qualification-decision.v1.schema"];
        BattleCardV1: components["schemas"]["battle-card.v1.schema"];
        BattleCardV2: components["schemas"]["battle-card.v2.schema"];
        BattleCard: components["schemas"]["battle-card.v1.schema"] | components["schemas"]["battle-card.v2.schema"];
        ReviewEvent: components["schemas"]["review-event.v1.schema"];
        OutcomeFeedback: components["schemas"]["outcome-feedback.v1.schema"];
        FinancialValueDecision: components["schemas"]["financial-value-decision.v1.schema"];
        PartyRef: components["schemas"]["party-ref.v1.schema"];
        CopilotSession: components["schemas"]["copilot-session.v1.schema"];
        CopilotMessage: components["schemas"]["copilot-message.v1.schema"];
        CopilotTask: components["schemas"]["copilot-task.v1.schema"];
        PlatformConnection: components["schemas"]["platform-connection.v1.schema"];
        PlatformCapabilitySnapshot: components["schemas"]["platform-capability-snapshot.v1.schema"];
        PlatformEvent: components["schemas"]["platform-event.v1.schema"];
        ActionPolicy: components["schemas"]["action-policy.v1.schema"];
        ActionReceipt: components["schemas"]["action-receipt.v1.schema"];
        DiscoveryEvidencePagedResult: {
            items: components["schemas"]["discovery-evidence.v1.schema"][];
            nextCursor: string | null;
        };
        ReviewEventPagedResult: {
            items: components["schemas"]["review-event.v1.schema"][];
            nextCursor: string | null;
        };
        OutcomeFeedbackPagedResult: {
            items: components["schemas"]["outcome-feedback.v1.schema"][];
            nextCursor: string | null;
        };
        AcquisitionPerformance: {
            counts: {
                discovered: number;
                highIntent: number;
                approved: number;
                converted: number;
                contacted: number;
                quoted: number;
                won: number;
                lost: number;
            };
            rates: {
                highIntentRate: number | null;
                approvalRate: number | null;
                crmConversionRate: number | null;
                contactRate: number | null;
                quoteRate: number | null;
                winRate: number | null;
            };
            valuesByCurrency: {
                currency: string;
                estimatedPipelineMinor: number;
                quotedMinor: number;
                wonContractMinor: number;
            }[];
            cost: {
                /** @enum {string} */
                status: "available" | "not_aggregatable";
                executionCostMinor: number | null;
                currency: string | null;
                /** @enum {string} */
                coverage: "recorded_api_execution_only";
            };
            roi: {
                /** @enum {string} */
                status: "not_computable";
                /** @enum {string} */
                reason: "channel_cost_or_verified_margin_unavailable";
            };
            dataQuality: {
                missingAttribution: number;
                missingFinancial: number;
                truncated: boolean;
                /** Format: date-time */
                lastReconciledAt: string | null;
            };
            briefingFacts: {
                headlines: components["schemas"]["AcquisitionPerformanceFact"][];
                risks: components["schemas"]["AcquisitionPerformanceFact"][];
                actions: components["schemas"]["AcquisitionPerformanceFact"][];
                metricIds: string[];
            };
        };
        AcquisitionPerformanceFact: {
            metricId: string;
            text: string;
            evidenceRefs: string[];
        };
        CopilotMessagePagedResult: {
            items: components["schemas"]["copilot-message.v1.schema"][];
            nextCursor: string | null;
        };
        IdentityResolution: {
            /** @constant */
            status: "resolved";
            /** @enum {unknown} */
            basis: "organization_domain" | "organization_credit_code" | "provider_public_actor";
            resolverVersion: string;
            evidenceIds: string[];
            /** Format: date-time */
            resolvedAt: string;
            resolvedBy: string;
        };
        IdentityConfirmationResult: {
            candidate: components["schemas"]["Candidate"];
            resolution: components["schemas"]["IdentityResolution"];
        };
        ResearchAttempt: {
            id: string;
            candidateId: string;
            requestReason: string;
            budgetVersion: string;
            /** @enum {unknown} */
            status: "pending" | "running" | "completed" | "no_new_evidence" | "access_restricted" | "failed";
            newEvidenceIds: string[];
            terminationReason: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            completedAt: string | null;
        };
        CandidateReviewResult: {
            candidate: components["schemas"]["Candidate"];
            review: components["schemas"]["review-event.v1.schema"];
            research: components["schemas"]["ResearchAttempt"] | null;
        };
        LeadConversion: {
            id: string;
            candidateId: string;
            decisionVersion: string;
            partyRef: components["schemas"]["party-ref.v1.schema"];
            leadId: string;
            reviewerId: string;
            evidenceSnapshotHash: string;
            /** Format: date-time */
            createdAt: string;
        };
        AuditEvent: {
            id: string;
            candidateId: string | null;
            actorId: string;
            eventType: string;
            /** @enum {unknown} */
            fromStatus: "discovered" | "unresolvable" | "normalized" | "qualified" | "pending_review" | "approved" | "rejected" | "do_not_contact" | "needs_research" | "converted_to_lead" | null;
            /** @enum {unknown} */
            toStatus: "discovered" | "unresolvable" | "normalized" | "qualified" | "pending_review" | "approved" | "rejected" | "do_not_contact" | "needs_research" | "converted_to_lead" | null;
            resourceId: string;
            /** Format: date-time */
            createdAt: string;
        };
        AuditEventPagedResult: {
            items: components["schemas"]["AuditEvent"][];
            nextCursor: string | null;
        };
        /** ModelConnection */
        "model-connection.v1.schema": {
            id: string;
            ownerId: string;
            teamId?: string | null;
            /** @enum {unknown} */
            provider: "openai" | "moonshot" | "minimax" | "zhipu" | "deepseek" | "qwen" | "doubao" | "hunyuan" | "qianfan";
            model: string;
            baseUrlFingerprint?: string;
            credentialVersion: number;
            capabilitySnapshot: {
                structuredOutput: boolean;
                toolCalling: boolean;
                parallelToolCalling: boolean;
                streaming: boolean;
                modelListing: boolean;
            };
            /** @enum {unknown} */
            status: "active" | "inactive" | "disabled";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt?: string;
        };
        /** ApiError */
        "api-error.v1.schema": {
            code: string;
            message: string;
            details: unknown;
            requestId: string;
            retryable: boolean;
        } | {
            error: {
                code: string;
                message: string;
                details?: unknown;
                requestId?: string;
            };
        };
        /** AsyncOperation */
        "async-operation.v1.schema": {
            id: string;
            kind: string;
            /** @enum {unknown} */
            status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
            resourceId?: string | null;
            error?: null | components["schemas"]["api-error.v1.schema"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            completedAt?: string | null;
        };
        /** ModelCallRecord */
        "model-call-record.v1.schema": {
            id: string;
            ownerId: string;
            teamId: string;
            jobId: string;
            attemptId: string;
            connectionId: string;
            credentialVersion: number;
            capabilitySnapshotHash: string;
            provider: string;
            baseUrlFingerprint: string;
            model: string;
            promptVersion: string;
            schemaVersion: string;
            requestId: string;
            providerRequestId?: string | null;
            inputTokens: number;
            outputTokens: number;
            reasoningTokens: number;
            latencyMs: number;
            /** @enum {unknown} */
            status: "succeeded" | "failed";
            error: Record<string, never> | null;
            cost: {
                amountMinor: number;
                currency: string;
                /** @enum {unknown} */
                kind: "estimated" | "actual" | "unknown";
            };
            parameterHash: string;
            resultHash: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** ProviderConnection */
        "provider-connection.v1.schema": {
            id: string;
            ownerId: string;
            teamId: string | null;
            providerId: string;
            /** @enum {unknown} */
            kind: "search" | "content_fetch" | "import";
            /** @enum {unknown} */
            status: "active" | "inactive" | "disabled" | "error";
            credentialVersion: number;
            /** Format: date-time */
            lastHealthAt: string | null;
            /** @enum {unknown} */
            lastHealthStatus: "untested" | "passed" | "failed";
            lastErrorCode: string | null;
            lastHealthMessage: string;
            usage: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** ContentFetchOperation */
        "content-fetch-operation.v1.schema": ({
            id: string;
            ownerId: string;
            teamId: string;
            actorId: string;
            /** Format: uri */
            sourceUrl: string;
            /** Format: uri */
            finalUrl: string | null;
            /** @enum {unknown} */
            subjectChannel: "organization" | "individual";
            /** @enum {unknown} */
            status: "queued" | "running" | "succeeded" | "failed" | "access_restricted";
            /** @enum {string|null} */
            accessStatus: "public_content" | "access_restricted" | null;
            httpStatus: number | null;
            contentType: string | null;
            title: string | null;
            rawArtifactHash: string | null;
            contentHash: string | null;
            evidenceCount: number;
            evidenceIds: string[];
            candidateCount: number;
            candidateIds: string[];
            errorCode: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            completedAt: string | null;
        } & (unknown & unknown & ({
            /** @constant */
            candidateCount: 0;
            candidateIds: unknown[];
        } | {
            /** @constant */
            candidateCount: 1;
            candidateIds: unknown[];
        } | unknown))) & ({
            /** @enum {unknown} */
            status?: "succeeded" | "access_restricted";
            /** @constant */
            evidenceCount?: 1;
            evidenceIds?: unknown[];
        } | {
            /** @enum {unknown} */
            status?: "queued" | "running";
            /** @constant */
            evidenceCount?: 0;
            evidenceIds?: unknown[];
        } | {
            /** @constant */
            status?: "failed";
            /** @constant */
            evidenceCount?: 0;
            evidenceIds?: unknown[];
        } | {
            /** @constant */
            status?: "failed";
            /** @constant */
            evidenceCount?: 1;
            evidenceIds?: unknown[];
        });
        /** ImportOperation */
        "import-operation.v1.schema": {
            id: string;
            ownerId: string;
            teamId: string;
            actorId: string;
            fileName: string;
            /** @enum {unknown} */
            mediaType: "text/csv" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            /** @enum {unknown} */
            subjectChannel: "organization" | "individual";
            artifactHash: string;
            /** @enum {unknown} */
            status: "queued" | "running" | "succeeded" | "partial_success" | "failed";
            rowCount: number;
            acceptedRowCount: number;
            errorRows: {
                sheetName: string;
                rowNumber: number;
                code: string;
                message: string;
            }[];
            evidenceCount: number;
            evidenceIds: string[];
            candidateCount: number;
            candidateIds: string[];
            errorCode: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            completedAt: string | null;
        } & (unknown & unknown & (unknown | {
            /** @constant */
            evidenceCount: 0;
            evidenceIds: unknown[];
        } | {
            evidenceCount: number;
            evidenceIds: unknown[];
        }) & (unknown | {
            /** @constant */
            candidateCount: 0;
            candidateIds: unknown[];
        } | {
            candidateCount: number;
            candidateIds: unknown[];
        }));
        /** DiscoveryEvidence */
        "discovery-evidence.v1.schema": {
            id: string;
            /** @enum {unknown} */
            targetType: "organization" | "individual_signal";
            sourcePlatform: string;
            sourceTitle: string;
            sourceSnippet: string;
            /** Format: date-time */
            publishedAt: string | null;
            /** Format: date-time */
            fetchedAt: string;
            locale: string;
            rawArtifactHash: string;
            contentHash: string;
            provenance: {
                /** @constant */
                kind: "search_result";
                provider: string;
                providerConnectionId?: string;
                requestId?: string;
                providerRecordId?: string;
                queryText: string;
                /** Format: uri */
                sourceUrl: string;
                resultRank: number | null;
                sourceType?: string;
            } | {
                /** @constant */
                kind: "user_submitted_url";
                /** Format: uri */
                sourceUrl: string;
                submittedBy: string;
            } | {
                /** @constant */
                kind: "import_artifact_row";
                importBatchId: string;
                artifactHash: string;
                sheetName: string;
                rowNumber: number;
                /** Format: uri */
                sourceUrl?: string;
            };
            /** @enum {unknown} */
            accessStatus: "indexed_summary" | "public_content" | "user_supplied" | "access_restricted";
        };
        budgetUsage: {
            requests: number;
            results: number;
            amountMinor: number;
            durationSeconds: number;
        };
        providerConnection: {
            connectionId: string;
            providerId: string;
            /** @enum {unknown} */
            kind: "search" | "content_fetch" | "import";
            /** @enum {unknown} */
            status: "active" | "inactive" | "disabled";
            credentialVersion: number;
        };
        operation: {
            operationId: string;
            /** @enum {unknown} */
            subjectChannel: "organization" | "individual";
            /** @enum {unknown} */
            kind: "search" | "content_fetch" | "import_rows";
            connectionId: string;
            query?: string;
            sourceRef?: string;
            allocatedBudget: components["schemas"]["budgetUsage"];
        };
        budgetSnapshot: {
            billingCurrency: string;
            maxRequests: number;
            maxResults: number;
            maxAmountMinor: number;
            maxDurationSeconds: number;
        };
        modelSnapshot: {
            jobSnapshotId: string;
            connectionId: string;
            credentialVersion: number;
            provider: string;
            model: string;
            capabilitySnapshotHash: string;
            promptVersion: string;
            schemaVersion: string;
            promptHash: string;
            schemaHash: string;
        };
        payload: {
            /** @enum {unknown} */
            targetPlatform?: "douyin" | "web";
            name: string;
            objective: string;
            icp: {
                industries: string[];
                regions: string[];
                organizationCriteria: string[];
                individualCriteria: string[];
                exclusionRules: string[];
            };
            subjectChannels: {
                organization: boolean;
                individual: boolean;
            };
            providerConnections: components["schemas"]["providerConnection"][];
            operations: components["schemas"]["operation"][];
            budgetSnapshot: components["schemas"]["budgetSnapshot"];
            modelSnapshotRef: components["schemas"]["modelSnapshot"];
            stopConditions: {
                stopWhenBudgetExhausted: boolean;
                stopWhenNoMoreResults: boolean;
            };
        };
        /** AcquisitionPlan */
        "acquisition-plan.v1.schema": {
            id: string;
            ownerId: string;
            teamId: string;
            /** @enum {unknown} */
            status: "draft" | "approved" | "archived";
            version: number;
            revision: number;
            etag: string;
            currentVersionId: string;
            approvedVersionId: string | null;
            approvedSnapshotHash: string | null;
            approvedBy: string | null;
            /** Format: date-time */
            approvedAt: string | null;
            budgetSnapshot: components["schemas"]["budgetSnapshot"];
            payload: components["schemas"]["payload"];
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            updatedBy: string;
            /** Format: date-time */
            updatedAt: string;
            $defs: {
                budgetUsage: {
                    requests: number;
                    results: number;
                    amountMinor: number;
                    durationSeconds: number;
                };
                budgetSnapshot: {
                    billingCurrency: string;
                    maxRequests: number;
                    maxResults: number;
                    maxAmountMinor: number;
                    maxDurationSeconds: number;
                };
                modelSnapshot: {
                    jobSnapshotId: string;
                    connectionId: string;
                    credentialVersion: number;
                    provider: string;
                    model: string;
                    capabilitySnapshotHash: string;
                    promptVersion: string;
                    schemaVersion: string;
                    promptHash: string;
                    schemaHash: string;
                };
                providerConnection: {
                    connectionId: string;
                    providerId: string;
                    /** @enum {unknown} */
                    kind: "search" | "content_fetch" | "import";
                    /** @enum {unknown} */
                    status: "active" | "inactive" | "disabled";
                    credentialVersion: number;
                };
                operation: {
                    operationId: string;
                    /** @enum {unknown} */
                    subjectChannel: "organization" | "individual";
                    /** @enum {unknown} */
                    kind: "search" | "content_fetch" | "import_rows";
                    connectionId: string;
                    query?: string;
                    sourceRef?: string;
                    allocatedBudget: components["schemas"]["budgetUsage"];
                };
                payload: {
                    /** @enum {unknown} */
                    targetPlatform?: "douyin" | "web";
                    name: string;
                    objective: string;
                    icp: {
                        industries: string[];
                        regions: string[];
                        organizationCriteria: string[];
                        individualCriteria: string[];
                        exclusionRules: string[];
                    };
                    subjectChannels: {
                        organization: boolean;
                        individual: boolean;
                    };
                    providerConnections: components["schemas"]["providerConnection"][];
                    operations: components["schemas"]["operation"][];
                    budgetSnapshot: components["schemas"]["budgetSnapshot"];
                    modelSnapshotRef: components["schemas"]["modelSnapshot"];
                    stopConditions: {
                        stopWhenBudgetExhausted: boolean;
                        stopWhenNoMoreResults: boolean;
                    };
                };
            };
        };
        /** AcquisitionRun */
        "acquisition-run.v1.schema": {
            id: string;
            ownerId: string;
            teamId: string;
            planId: string;
            planVersionId: string;
            planVersion: number;
            planSnapshotHash: string;
            parentRunId: string | null;
            /** @enum {unknown} */
            status: "queued" | "running" | "pause_requested" | "paused" | "cancel_requested" | "cancelled" | "succeeded" | "succeeded_empty" | "partial_success" | "failed" | "budget_exhausted";
            /** @enum {unknown} */
            terminationIntent: "cancelled" | "budget_exhausted" | null;
            revision: number;
            etag: string;
            budgetSnapshotId: string;
            budgetSnapshot: components["schemas"]["budgetSnapshot"];
            budgetSnapshotHash: string;
            billingCurrency: string;
            modelSnapshotRef: components["schemas"]["modelSnapshot"];
            consumedBudget: components["schemas"]["budgetUsage"];
            evidenceCount: number;
            reason: string | null;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            updatedBy: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            completedAt: string | null;
            $defs: {
                budgetUsage: {
                    requests: number;
                    results: number;
                    amountMinor: number;
                    durationSeconds: number;
                };
                budgetSnapshot: {
                    billingCurrency: string;
                    maxRequests: number;
                    maxResults: number;
                    maxAmountMinor: number;
                    maxDurationSeconds: number;
                };
                modelSnapshot: {
                    jobSnapshotId: string;
                    connectionId: string;
                    credentialVersion: number;
                    provider: string;
                    model: string;
                    capabilitySnapshotHash: string;
                    promptVersion: string;
                    schemaVersion: string;
                    promptHash: string;
                    schemaHash: string;
                };
            };
        };
        /** AcquisitionRunPresentation */
        "acquisition-run-presentation.v1.schema": {
            run: {
                id: string;
                /** @enum {string} */
                status: "queued" | "running" | "pause_requested" | "paused" | "cancel_requested" | "cancelled" | "succeeded" | "succeeded_empty" | "partial_success" | "failed" | "budget_exhausted";
                etag: string;
                /** Format: date-time */
                updatedAt: string;
                /** Format: date-time */
                completedAt: null | string;
            };
            providers: {
                shardId: string;
                connectionId: string;
                providerId: string;
                status: string;
                rawResultCount: number;
                acceptedResultCount: number;
                duplicateResultCount: number;
                failedResultCount: number;
                errorCode: null | string;
                /** Format: date-time */
                retryAfterAt: null | string;
            }[];
            summary: {
                sourcesSearched: number;
                /** @description 所有运行分片持久化的执行结果页数。 */
                pagesAnalyzed: number;
                organizationsFound: number;
                dedupedCandidates: number;
                validOpportunities: number;
                highIntent: number;
                financialEvaluatedHighIntentCount: number;
                financialPendingHighIntentCount: number;
                /** @description 仅合计高意向且绑定当前资格决定的财务值；币种不换算。 */
                expectedRevenueByCurrency: {
                    currency: string;
                    amountMinor: number;
                }[];
            };
            candidateEvents: {
                eventId: string;
                /** Format: date-time */
                createdAt: string;
                candidateId: string;
                candidate: {
                    id: string;
                    /** @enum {string} */
                    subjectKind: "organization" | "individual";
                    displayName: string;
                    industry: null | string;
                    region: null | string;
                    domain: null | string;
                    status: string;
                    version: number;
                    identityResolved: boolean;
                    /** Format: date-time */
                    updatedAt: string;
                };
                qualification: null | {
                    id: string;
                    candidateId: string;
                    decisionVersion: string;
                    /** @enum {string} */
                    decisionEngine: "model" | "rules";
                    /** @enum {string} */
                    grade: "S" | "A" | "B" | "C" | "D";
                    score: number;
                    /** @enum {string} */
                    recommendedAction: "priority_review" | "public_response" | "nurture" | "observe" | "do_not_contact";
                    evidence: {
                        evidenceId: string;
                        excerpt: string;
                    }[];
                    positiveSignals: {
                        name: string;
                        score: number;
                    }[];
                    negativeSignals: {
                        name: string;
                        score: number;
                    }[];
                    reasons: string[];
                    confidence: number;
                    ruleVersion: string;
                    promptVersion: null | string;
                    modelProvider: null | string;
                    model: null | string;
                    hardGateFailures: ("missing_original_source" | "identity_unresolved" | "do_not_contact" | "explicit_rejection" | "non_public_or_sensitive_data" | "stale_evidence" | "schema_invalid")[];
                    /** Format: date-time */
                    createdAt: string;
                };
                financialValue: null | {
                    id: string;
                    candidateId: string;
                    qualificationDecisionId: string;
                    version: string;
                    /** @enum {string} */
                    grade: "S" | "A" | "B" | "C" | "D";
                    score: number;
                    currency: string;
                    expectedRevenueMinor: number;
                    expectedGrossProfitMinor: number;
                    expectedContributionMinor: number;
                    factors: {
                        profitability: number;
                        cashFlow: number;
                        creditQuality: number;
                        repeatPotential: number;
                        referralPotential: number;
                        closeProbability: number;
                    };
                    /** Format: date-time */
                    createdAt: string;
                };
                sourcePlatforms: string[];
                evidenceCount: number;
            }[];
            nextAfter: string;
            hasMore: boolean;
        };
        /** OrganizationCandidate */
        "organization-candidate.v1.schema": {
            id: string;
            name: string;
            domain: string | null;
            region: string | null;
            creditCode: string | null;
            evidenceIds: string[];
            /** @constant */
            subjectKind: "organization";
            version: number;
            identityResolved: boolean;
            /** @enum {unknown} */
            status: "discovered" | "unresolvable" | "normalized" | "qualified" | "pending_review" | "approved" | "rejected" | "do_not_contact" | "needs_research" | "converted_to_lead";
            latestDecisionVersion: string | null;
            approvedDecisionVersion: string | null;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** IndividualDemandSignal */
        "individual-demand-signal.v1.schema": {
            id: string;
            publicActorKey: string;
            publicDisplayName: string;
            /** Format: uri */
            publicProfileUrl: string;
            sourcePlatform: string;
            evidenceIds: string[];
            demandCategory: string;
            demandSummary: string;
            locationHint: string;
            /** @enum {unknown} */
            buyingStage: "awareness" | "problem_defined" | "solution_research" | "comparison" | "purchase_ready";
            negativeSignals: string[];
            /** @constant */
            subjectKind: "individual";
            version: number;
            identityResolved: boolean;
            /** @enum {unknown} */
            status: "discovered" | "unresolvable" | "normalized" | "qualified" | "pending_review" | "approved" | "rejected" | "do_not_contact" | "needs_research" | "converted_to_lead";
            latestDecisionVersion: string | null;
            approvedDecisionVersion: string | null;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            firstSeenAt: string;
            /** Format: date-time */
            lastSeenAt: string;
        };
        /** CandidateIntelligenceOperation */
        "candidate-intelligence-operation.v1.schema": {
            id: string;
            candidateId: string;
            /** @enum {unknown} */
            status: "queued" | "running" | "succeeded" | "failed";
            /** @enum {unknown} */
            currentStage: "research" | "qualification" | "battle_card" | null;
            completedStages: ("research" | "qualification" | "battle_card")[];
            skippedStages: ("research" | "qualification" | "battle_card")[];
            research: {
                summary: string;
                findings: {
                    label: string;
                    content: string;
                    evidenceIds: string[];
                    confidence: number | null;
                }[];
            } | null;
            qualification: {
                /** @enum {unknown} */
                grade: "S" | "A" | "B" | "C" | "D";
                score: number;
                hardGateFailures: string[];
                financialValueId: string;
            } | null;
            battleCardId: string | null;
            failure: {
                /** @enum {unknown} */
                stage: "research" | "qualification" | "battle_card";
                errorCode: string;
            } | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            completedAt: string | null;
            /** Format: date-time */
            failedAt: string | null;
        };
        /** QualificationDecision */
        "qualification-decision.v1.schema": {
            /** @enum {unknown} */
            decisionEngine: "model" | "rules";
            /** @enum {unknown} */
            grade: "S" | "A" | "B" | "C" | "D";
            score: number;
            /** @enum {unknown} */
            recommendedAction: "priority_review" | "public_response" | "nurture" | "observe" | "do_not_contact";
            evidence: {
                evidenceId: string;
                excerpt?: string;
            }[];
            positiveSignals: {
                name: string;
                score: number;
            }[];
            negativeSignals: {
                name: string;
                score: number;
            }[];
            reasons: string[];
            confidence: number;
            ruleVersion: string;
            promptVersion: string | null;
            modelProvider: string | null;
            model: string | null;
        } & unknown;
        /** FinancialValueDecision */
        "financial-value-decision.v1.schema": {
            id: string;
            candidateId: string;
            qualificationDecisionId: string;
            version: string;
            /** @enum {unknown} */
            grade: "S" | "A" | "B" | "C" | "D";
            score: number;
            currency: string;
            expectedRevenueMinor: number;
            expectedGrossProfitMinor: number;
            expectedContributionMinor: number;
            factors: {
                profitability: number;
                cashFlow: number;
                creditQuality: number;
                repeatPotential: number;
                referralPotential: number;
                closeProbability: number;
            };
            /** Format: date-time */
            createdAt: string;
        };
        /** BattleCard */
        "battle-card.v1.schema": {
            id: string;
            candidateId: string;
            qualificationDecisionId: string;
            /** @enum {unknown} */
            partyType: "organization" | "individual";
            /** @constant */
            schemaVersion: "battle-card.v1";
            intelligence: null;
            sections: ({
                label: string;
                /** @enum {unknown} */
                kind: "fact" | "inference" | "unknown";
                content: string;
                evidenceIds?: string[];
                confidence?: number | null;
            } & unknown)[];
            evidenceIds: string[];
            confidence: number;
            modelProvider: string;
            model: string;
            promptVersion: string;
            /** Format: date-time */
            createdAt: string;
        };
        claim: {
            /** @enum {unknown} */
            kind: "fact" | "inference" | "unknown";
            text: string;
            evidenceIds: string[];
            confidence: number | null;
        } & (unknown & unknown & unknown);
        factors: {
            profitability: number;
            cashFlow: number;
            creditQuality: number;
            repeatPotential: number;
            referralPotential: number;
            closeProbability: number;
        };
        buyingRole: {
            role: string;
            /** @enum {unknown} */
            priority: 1 | 2 | 3;
            /** @enum {unknown} */
            influence: "decision_maker" | "influencer" | "user" | "gatekeeper";
            concerns: string[];
            claim: components["schemas"]["claim"];
        };
        connectionStrategy: {
            /** @enum {unknown} */
            channel: "public_reply" | "wecom" | "phone" | "email" | "referral";
            targetRole: string;
            rationale: components["schemas"]["claim"];
            openingDraft: string;
        };
        roleOpener: {
            role: string;
            /** @enum {unknown} */
            channel: "public_reply" | "wecom" | "phone" | "email" | "referral";
            text: string;
        };
        financialSummary: {
            decisionId: string;
            decisionVersion: string;
            /** @enum {unknown} */
            grade: "S" | "A" | "B" | "C" | "D";
            score: number;
            currency: string;
            expectedRevenueMinor: number;
            expectedGrossProfitMinor: number;
            expectedContributionMinor: number;
            factors: components["schemas"]["factors"];
        };
        intelligence: {
            accountOverview: components["schemas"]["claim"][];
            needAssessment: components["schemas"]["claim"][];
            supplierHypotheses: components["schemas"]["claim"][];
            buyingCommittee: components["schemas"]["buyingRole"][];
            procurementPreferences: components["schemas"]["claim"][];
            connectionStrategies: components["schemas"]["connectionStrategy"][];
            roleSpecificOpeners: components["schemas"]["roleOpener"][];
            doNotActions: string[];
            financialSummary: components["schemas"]["financialSummary"] | null;
        };
        /** BattleCardV2 */
        "battle-card.v2.schema": {
            id: string;
            candidateId: string;
            qualificationDecisionId: string;
            /** @enum {unknown} */
            partyType: "organization" | "individual";
            /** @constant */
            schemaVersion: "battle-card.v2";
            intelligence: components["schemas"]["intelligence"];
            evidenceIds: string[];
            confidence: number;
            modelProvider: string;
            model: string;
            promptVersion: string;
            /** Format: date-time */
            createdAt: string;
            $defs: {
                claim: {
                    /** @enum {unknown} */
                    kind: "fact" | "inference" | "unknown";
                    text: string;
                    evidenceIds: string[];
                    confidence: number | null;
                } & (unknown & unknown & unknown);
                buyingRole: {
                    role: string;
                    /** @enum {unknown} */
                    priority: 1 | 2 | 3;
                    /** @enum {unknown} */
                    influence: "decision_maker" | "influencer" | "user" | "gatekeeper";
                    concerns: string[];
                    claim: components["schemas"]["claim"];
                };
                connectionStrategy: {
                    /** @enum {unknown} */
                    channel: "public_reply" | "wecom" | "phone" | "email" | "referral";
                    targetRole: string;
                    rationale: components["schemas"]["claim"];
                    openingDraft: string;
                };
                roleOpener: {
                    role: string;
                    /** @enum {unknown} */
                    channel: "public_reply" | "wecom" | "phone" | "email" | "referral";
                    text: string;
                };
                factors: {
                    profitability: number;
                    cashFlow: number;
                    creditQuality: number;
                    repeatPotential: number;
                    referralPotential: number;
                    closeProbability: number;
                };
                financialSummary: {
                    decisionId: string;
                    decisionVersion: string;
                    /** @enum {unknown} */
                    grade: "S" | "A" | "B" | "C" | "D";
                    score: number;
                    currency: string;
                    expectedRevenueMinor: number;
                    expectedGrossProfitMinor: number;
                    expectedContributionMinor: number;
                    factors: components["schemas"]["factors"];
                };
                intelligence: {
                    accountOverview: components["schemas"]["claim"][];
                    needAssessment: components["schemas"]["claim"][];
                    supplierHypotheses: components["schemas"]["claim"][];
                    buyingCommittee: components["schemas"]["buyingRole"][];
                    procurementPreferences: components["schemas"]["claim"][];
                    connectionStrategies: components["schemas"]["connectionStrategy"][];
                    roleSpecificOpeners: components["schemas"]["roleOpener"][];
                    doNotActions: string[];
                    financialSummary: components["schemas"]["financialSummary"] | null;
                };
            };
        };
        /** ReviewEvent */
        "review-event.v1.schema": {
            id: string;
            candidateId: string;
            decisionVersion: string;
            /** @enum {unknown} */
            action: "approved" | "rejected" | "do_not_contact" | "needs_research" | "reopen";
            reason?: string | null;
            reviewerId: string;
            idempotencyKey: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** PartyRef */
        "party-ref.v1.schema": {
            /** @constant */
            partyType: "organization";
            organizationId: string;
            tenantProspectId: string;
        } | {
            /** @constant */
            partyType: "individual";
            individualPartyId: string;
            demandSignalId: string;
        };
        amount: {
            amountMinor: number;
            currency: string;
        };
        organizationPartyRef: {
            /** @constant */
            partyType: "organization";
            organizationId: string;
            tenantProspectId: string;
        };
        individualPartyRef: {
            /** @constant */
            partyType: "individual";
            individualPartyId: string;
            demandSignalId: string;
        };
        liveAttribution: {
            /** @constant */
            attributionVersion: "acquisition-run.v1";
            runId: string;
            planId: string;
            planVersionId: string;
            planVersion: number;
            planSnapshotHash: string;
            discoveredEventId: string;
            /** Format: date-time */
            discoveredAt: string;
            shardId: string;
            operationId: string;
            connectionId: string;
            providerId: string;
            evidenceIds: string[];
            providerIds: string[];
            queryIds: string[];
            strategyVersion: string;
            qualificationDecisionId: string;
            decisionVersion: string;
            decisionSnapshotHash: string;
            /** @enum {unknown} */
            decisionEngine: "model" | "rules";
            ruleVersion: string;
            modelProvider: string | null;
            model: string | null;
            promptVersion: string | null;
        };
        legacyAttribution: {
            runId: string | null;
            evidenceIds: string[];
            providerIds: string[];
            queryIds: string[];
            strategyVersion: string | null;
            qualificationDecisionId: string | null;
            decisionVersion: string | null;
            decisionSnapshotHash: string | null;
            /** @enum {unknown} */
            decisionEngine: "model" | "rules" | null;
            ruleVersion: string | null;
            modelProvider: string | null;
            model: string | null;
            promptVersion: string | null;
        };
        /** OutcomeFeedback */
        "outcome-feedback.v1.schema": {
            $defs: {
                organizationPartyRef: {
                    /** @constant */
                    partyType: "organization";
                    organizationId: string;
                    tenantProspectId: string;
                };
                individualPartyRef: {
                    /** @constant */
                    partyType: "individual";
                    individualPartyId: string;
                    demandSignalId: string;
                };
                amount: {
                    amountMinor: number;
                    currency: string;
                };
                liveAttribution: {
                    /** @constant */
                    attributionVersion: "acquisition-run.v1";
                    runId: string;
                    planId: string;
                    planVersionId: string;
                    planVersion: number;
                    planSnapshotHash: string;
                    discoveredEventId: string;
                    /** Format: date-time */
                    discoveredAt: string;
                    shardId: string;
                    operationId: string;
                    connectionId: string;
                    providerId: string;
                    evidenceIds: string[];
                    providerIds: string[];
                    queryIds: string[];
                    strategyVersion: string;
                    qualificationDecisionId: string;
                    decisionVersion: string;
                    decisionSnapshotHash: string;
                    /** @enum {unknown} */
                    decisionEngine: "model" | "rules";
                    ruleVersion: string;
                    modelProvider: string | null;
                    model: string | null;
                    promptVersion: string | null;
                };
                legacyAttribution: {
                    runId: string | null;
                    evidenceIds: string[];
                    providerIds: string[];
                    queryIds: string[];
                    strategyVersion: string | null;
                    qualificationDecisionId: string | null;
                    decisionVersion: string | null;
                    decisionSnapshotHash: string | null;
                    /** @enum {unknown} */
                    decisionEngine: "model" | "rules" | null;
                    ruleVersion: string | null;
                    modelProvider: string | null;
                    model: string | null;
                    promptVersion: string | null;
                };
            };
        } & ({
            id: string;
            ownerId: string;
            teamId: string;
            leadId: string | null;
            customerId: string | null;
            /** @enum {unknown} */
            eventType: "validated" | "contacted" | "replied" | "rejected" | "do_not_contact" | "private_domain_entered" | "need_confirmed" | "quoted" | "won" | "lost" | "payment_received";
            /** Format: date-time */
            occurredAt: string;
            amount: components["schemas"]["amount"] | null;
            reasonCode: string | null;
            reasonText: string | null;
            idempotencyKey: string;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** @constant */
            recordKind: "live";
            partyRef: components["schemas"]["organizationPartyRef"] | components["schemas"]["individualPartyRef"];
            candidateId: string;
            attribution: components["schemas"]["liveAttribution"];
        } | {
            id: string;
            ownerId: string;
            teamId: string;
            leadId: string | null;
            customerId: string | null;
            /** @enum {unknown} */
            eventType: "validated" | "contacted" | "replied" | "rejected" | "do_not_contact" | "private_domain_entered" | "need_confirmed" | "quoted" | "won" | "lost" | "payment_received";
            /** Format: date-time */
            occurredAt: string;
            amount: components["schemas"]["amount"] | null;
            reasonCode: string | null;
            reasonText: string | null;
            idempotencyKey: string;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** @constant */
            recordKind: "legacy_migrated";
            legacySourceId: string;
            partyRef: components["schemas"]["organizationPartyRef"] | null;
            candidateId: string | null;
            attribution: components["schemas"]["legacyAttribution"];
            migrationWarnings: string[];
        });
        /** CopilotSession */
        "copilot-session.v1.schema": {
            id: string;
            ownerId: string;
            teamId: string;
            /** @enum {unknown} */
            status: "active" | "completed" | "failed";
            modelSnapshot: {
                connectionId: string;
                credentialVersion: number;
                provider: string;
                model: string;
                promptVersion: string;
                schemaVersion: string;
                promptHash: string;
                schemaHash: string;
            };
            /** Format: date-time */
            createdAt: string;
        };
        textContent: {
            /** @constant */
            type: "text";
            text: string;
            textSignature?: string;
        };
        imageContent: {
            /** @constant */
            type: "image";
            data: string;
            mimeType: string;
        };
        thinkingContent: {
            /** @constant */
            type: "thinking";
            thinking: string;
            thinkingSignature?: string;
            redacted?: boolean;
        };
        toolCall: {
            /** @constant */
            type: "toolCall";
            id: string;
            name: string;
            arguments: {
                [key: string]: unknown;
            };
            thoughtSignature?: string;
        };
        inputContent: components["schemas"]["textContent"] | components["schemas"]["imageContent"];
        assistantContent: components["schemas"]["textContent"] | components["schemas"]["thinkingContent"] | components["schemas"]["toolCall"];
        usage: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            cacheWrite1h?: number;
            reasoning?: number;
            totalTokens: number;
            cost: {
                input: number;
                output: number;
                cacheRead: number;
                cacheWrite: number;
                total: number;
            };
        };
        /** CopilotMessage */
        "copilot-message.v1.schema": {
            id: string;
            sessionId: string;
            sequence: number;
            message: {
                /** @constant */
                role: "user";
                content: string | components["schemas"]["inputContent"][];
                timestamp: number;
            } | {
                /** @constant */
                role: "assistant";
                content: components["schemas"]["assistantContent"][];
                api: string;
                provider: string;
                model: string;
                responseModel?: string;
                responseId?: string;
                diagnostics?: unknown[];
                usage: components["schemas"]["usage"];
                /** @enum {unknown} */
                stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
                errorMessage?: string;
                timestamp: number;
            } | {
                /** @constant */
                role: "toolResult";
                toolCallId: string;
                toolName: string;
                content: components["schemas"]["inputContent"][];
                details?: unknown;
                usage?: components["schemas"]["usage"];
                addedToolNames?: string[];
                isError: boolean;
                timestamp: number;
            };
            /** Format: date-time */
            createdAt: string;
            $defs: {
                textContent: {
                    /** @constant */
                    type: "text";
                    text: string;
                    textSignature?: string;
                };
                imageContent: {
                    /** @constant */
                    type: "image";
                    data: string;
                    mimeType: string;
                };
                thinkingContent: {
                    /** @constant */
                    type: "thinking";
                    thinking: string;
                    thinkingSignature?: string;
                    redacted?: boolean;
                };
                toolCall: {
                    /** @constant */
                    type: "toolCall";
                    id: string;
                    name: string;
                    arguments: {
                        [key: string]: unknown;
                    };
                    thoughtSignature?: string;
                };
                inputContent: components["schemas"]["textContent"] | components["schemas"]["imageContent"];
                assistantContent: components["schemas"]["textContent"] | components["schemas"]["thinkingContent"] | components["schemas"]["toolCall"];
                usage: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                    cacheWrite1h?: number;
                    reasoning?: number;
                    totalTokens: number;
                    cost: {
                        input: number;
                        output: number;
                        cacheRead: number;
                        cacheWrite: number;
                        total: number;
                    };
                };
            };
        };
        /** CopilotTask */
        "copilot-task.v1.schema": {
            id: string;
            sessionId: string;
            /** @constant */
            kind: "message";
            /** @enum {unknown} */
            status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
            /** @enum {unknown} */
            responseMode: "assistant" | "plan_draft";
            /** @enum {unknown} */
            targetPlatform?: "douyin" | "web";
            result: {
                [key: string]: unknown;
            } | null;
            errorCode: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            completedAt: string | null;
        };
        /** ModelProvider */
        "model-provider.v1.schema": {
            /** @enum {unknown} */
            id: "openai" | "moonshot" | "minimax" | "zhipu" | "deepseek" | "qwen" | "doubao" | "hunyuan" | "qianfan";
            displayName: string;
            protocol: string;
        };
        /** DiscoveryProvider */
        "discovery-provider.v1.schema": {
            id: string;
            /** @enum {unknown} */
            kind: "search" | "content_fetch" | "import";
            displayName: string;
            capabilities: string[];
        };
        /** AcquisitionOperationShard */
        "acquisition-operation-shard.v1.schema": {
            id: string;
            runId: string;
            parentShardId: string | null;
            /** @enum {unknown} */
            kind: "search" | "content_fetch" | "import_rows";
            sourceRef: string;
            budgetSnapshotId: string;
            allocatedBudget: {
                requests: number;
                results: number;
                amountMinor: number;
                durationSeconds: number;
            };
            consumedBudget: {
                requests: number;
                results: number;
                amountMinor: number;
                durationSeconds: number;
            };
            /** @enum {unknown} */
            status: "queued" | "running" | "retry_scheduled" | "pause_requested" | "paused" | "cancel_requested" | "cancelled" | "succeeded" | "succeeded_empty" | "partial_success" | "failed" | "budget_exhausted";
        };
        boundedString: string;
        /** @description Canonical immutable SHA-256 digest: sha256: followed by exactly 64 lowercase hexadecimal characters. */
        digest: string;
        snapshotRef: {
            id: components["schemas"]["boundedString"];
            hash: components["schemas"]["digest"];
        };
        limit: {
            limit: number | null;
            remaining: number | null;
            /** Format: date-time */
            resetsAt: string | null;
        };
        /** PlatformConnection */
        "platform-connection.v1.schema": {
            id: components["schemas"]["boundedString"];
            tenantId: components["schemas"]["boundedString"];
            teamId: components["schemas"]["boundedString"] | null;
            connectorId: components["schemas"]["boundedString"];
            platform: string;
            platformAccountRef: components["schemas"]["boundedString"];
            scopes: string[];
            credentialVersion: number;
            sync: {
                /** @enum {unknown} */
                mode: "webhook" | "poll" | "hybrid" | "disabled";
                cursor: string | null;
            };
            /** @enum {unknown} */
            status: "pending" | "active" | "reauthorization_required" | "revoked" | "disabled" | "error";
            /** Format: date-time */
            authorizationExpiresAt: string | null;
            limits: {
                [key: string]: components["schemas"]["limit"];
            };
            /** @description Null only before the first capability capture; active connections require a current snapshot reference. */
            capabilitySnapshotRef: components["schemas"]["snapshotRef"] | null;
            createdBy: components["schemas"]["boundedString"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            $defs: {
                boundedString: string;
                /** @description Canonical immutable SHA-256 digest: sha256: followed by exactly 64 lowercase hexadecimal characters. */
                digest: string;
                snapshotRef: {
                    id: components["schemas"]["boundedString"];
                    hash: components["schemas"]["digest"];
                };
                limit: {
                    limit: number | null;
                    remaining: number | null;
                    /** Format: date-time */
                    resetsAt: string | null;
                };
            };
        } & unknown;
        capability: {
            /** @enum {unknown} */
            status: "available" | "unavailable" | "authorization_required" | "temporarily_unavailable";
            scopes: string[];
            limitRefs: string[];
            reasonCode: string | null;
        };
        /** @description Extensible identifier: 1-100 ASCII characters, starting with alphanumeric and continuing with alphanumeric, dot, underscore, colon, or hyphen. */
        extensibleIdentifier: string;
        /** PlatformCapabilitySnapshot */
        "platform-capability-snapshot.v1.schema": {
            id: components["schemas"]["boundedString"];
            tenantId: components["schemas"]["boundedString"];
            teamId: components["schemas"]["boundedString"] | null;
            connectionId: components["schemas"]["boundedString"];
            credentialVersion: number;
            snapshotHash: components["schemas"]["digest"];
            /** Format: date-time */
            capturedAt: string;
            /** Format: date-time */
            expiresAt: string;
            capturedBy: components["schemas"]["boundedString"];
            capabilities: {
                [key: string]: components["schemas"]["capability"];
            };
            $defs: {
                boundedString: string;
                /** @description Canonical immutable SHA-256 digest: sha256: followed by exactly 64 lowercase hexadecimal characters. */
                digest: string;
                /** @description Extensible identifier: 1-100 ASCII characters, starting with alphanumeric and continuing with alphanumeric, dot, underscore, colon, or hyphen. */
                extensibleIdentifier: string;
                capability: {
                    /** @enum {unknown} */
                    status: "available" | "unavailable" | "authorization_required" | "temporarily_unavailable";
                    scopes: string[];
                    limitRefs: string[];
                    reasonCode: string | null;
                };
            };
        };
        /** PlatformEvent */
        "platform-event.v1.schema": {
            id: components["schemas"]["boundedString"];
            tenantId: components["schemas"]["boundedString"];
            teamId: components["schemas"]["boundedString"] | null;
            platform: string;
            platformAccountRef: components["schemas"]["boundedString"];
            platformContentRef: components["schemas"]["boundedString"];
            platformEventRef: components["schemas"]["boundedString"];
            platformSubjectRef: components["schemas"]["boundedString"];
            eventType: string;
            rawPayloadHash: components["schemas"]["digest"];
            normalizedEventHash: components["schemas"]["digest"];
            /** Format: date-time */
            occurredAt: string;
            /** Format: date-time */
            capturedAt: string;
            authorizationSnapshot: {
                connectionId: components["schemas"]["boundedString"];
                credentialVersion: number;
                scopeHash: components["schemas"]["digest"];
                capabilitySnapshotRef: components["schemas"]["snapshotRef"];
            };
            dedupeKey: string;
            /** @enum {unknown} */
            accessStatus: "available" | "restricted" | "deleted" | "authorization_revoked";
            capturedBy: components["schemas"]["boundedString"];
            $defs: {
                boundedString: string;
                /** @description Canonical immutable SHA-256 digest: sha256: followed by exactly 64 lowercase hexadecimal characters. */
                digest: string;
                snapshotRef: {
                    id: components["schemas"]["boundedString"];
                    hash: components["schemas"]["digest"];
                };
            };
        };
        planRef: {
            id: components["schemas"]["boundedString"];
            version: number;
            hash: components["schemas"]["digest"];
        };
        ruleBundleRef: {
            id: components["schemas"]["boundedString"];
            version: string;
            hash: components["schemas"]["digest"];
        };
        /** ActionPolicy */
        "action-policy.v1.schema": {
            id: components["schemas"]["boundedString"];
            tenantId: components["schemas"]["boundedString"];
            teamId: components["schemas"]["boundedString"] | null;
            version: number;
            planRef: components["schemas"]["planRef"];
            ruleBundleRef: components["schemas"]["ruleBundleRef"];
            policyHash: components["schemas"]["digest"];
            actions: {
                [key: string]: "auto_allowed" | "review_required" | "blocked";
            };
            /** Format: date-time */
            effectiveAt: string;
            /** Format: date-time */
            expiresAt: string | null;
            createdBy: components["schemas"]["boundedString"];
            /** Format: date-time */
            createdAt: string;
            $defs: {
                boundedString: string;
                /** @description Canonical immutable SHA-256 digest: sha256: followed by exactly 64 lowercase hexadecimal characters. */
                digest: string;
                /** @description Extensible identifier: 1-100 ASCII characters, starting with alphanumeric and continuing with alphanumeric, dot, underscore, colon, or hyphen. */
                extensibleIdentifier: string;
                planRef: {
                    id: components["schemas"]["boundedString"];
                    version: number;
                    hash: components["schemas"]["digest"];
                };
                ruleBundleRef: {
                    id: components["schemas"]["boundedString"];
                    version: string;
                    hash: components["schemas"]["digest"];
                };
            };
        };
        normalizedError: {
            /** @enum {unknown} */
            category: "capability_unavailable" | "authorization_insufficient" | "quota_exhausted" | "rate_limited" | "temporary_error" | "permanent_error" | "result_unknown";
            code: string;
            message: string;
            retryable: boolean;
        };
        immutableRef: {
            id: components["schemas"]["boundedString"];
            hash: components["schemas"]["digest"];
        };
        /** ActionReceipt */
        "action-receipt.v1.schema": {
            id: components["schemas"]["boundedString"];
            tenantId: components["schemas"]["boundedString"];
            teamId: components["schemas"]["boundedString"] | null;
            intentRef: components["schemas"]["immutableRef"];
            decisionRef: components["schemas"]["immutableRef"];
            jobRef: {
                id: components["schemas"]["boundedString"];
                attempt: number;
            };
            connectionRef: {
                id: components["schemas"]["boundedString"];
                credentialVersion: number;
            };
            capabilitySnapshotRef: components["schemas"]["immutableRef"];
            /** @description Bounded idempotency key containing at least one non-whitespace character. */
            idempotencyKey: string;
            externalId: components["schemas"]["boundedString"] | null;
            /** @enum {unknown} */
            outcome: "succeeded" | "failed" | "unknown";
            error: components["schemas"]["normalizedError"] | null;
            requestHash: components["schemas"]["digest"];
            resultHash: components["schemas"]["digest"];
            /** Format: date-time */
            requestedAt: string;
            /** Format: date-time */
            completedAt: string;
            /** Format: date-time */
            recordedAt: string;
            recordedBy: components["schemas"]["boundedString"];
            $defs: {
                boundedString: string;
                /** @description Canonical immutable SHA-256 digest: sha256: followed by exactly 64 lowercase hexadecimal characters. */
                digest: string;
                immutableRef: {
                    id: components["schemas"]["boundedString"];
                    hash: components["schemas"]["digest"];
                };
                normalizedError: {
                    /** @enum {unknown} */
                    category: "capability_unavailable" | "authorization_insufficient" | "quota_exhausted" | "rate_limited" | "temporary_error" | "permanent_error" | "result_unknown";
                    code: string;
                    message: string;
                    retryable: boolean;
                };
            };
        } & unknown;
    };
    responses: never;
    parameters: {
        id: string;
        cursor: string;
        limit: number;
        candidateId: string;
        idempotencyKey: string;
        /** @description 租户作用域内的写入幂等键；原文不会持久化。 */
        planIdempotencyKey: string;
        ifMatch: string;
        acquisitionId: string;
        acquisitionCursor: string;
        acquisitionLimit: number;
        candidateIfMatch: string;
        presentationAfter: string;
        presentationLimit: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listAcquisitionProviders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Discovery provider catalog */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            /** @enum {string} */
                            kind: "search" | "content_fetch" | "import";
                            displayName: string;
                            /** Format: uri */
                            officialDocsUrl?: string;
                            /** Format: uri */
                            defaultBaseUrl?: string;
                            requiresKey?: boolean;
                            keyHint?: string;
                            costNote?: string;
                            capabilities: string[];
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionProviderConnections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Provider connections */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["provider-connection.v1.schema"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionProviderConnection: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    providerId: string;
                    /** @description 客户自己的官方 API Key，仅加密保存且永不回显。 */
                    apiKey: string;
                    /** Format: uri */
                    baseUrl?: string;
                    /**
                     * @default active
                     * @enum {string}
                     */
                    status?: "active" | "disabled";
                };
            };
        };
        responses: {
            /** @description Idempotent replay */
            200: {
                headers: {
                    "Idempotency-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["provider-connection.v1.schema"];
                };
            };
            /** @description Provider connection created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["provider-connection.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionProviderConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Provider connection */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["provider-connection.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    deleteAcquisitionProviderConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Provider connection deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    updateAcquisitionProviderConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description 客户自己的官方 API Key，仅加密保存且永不回显。 */
                    apiKey: string;
                    /** Format: uri */
                    baseUrl?: string;
                    /** @enum {string} */
                    status?: "active" | "disabled";
                } | {
                    /** @enum {string} */
                    status: "active" | "disabled";
                };
            };
        };
        responses: {
            /** @description Provider connection updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["provider-connection.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    testAcquisitionProviderConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Provider connection health check */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        message: string;
                        errorCode: string | null;
                        retryable: boolean;
                        /** Format: date-time */
                        retryAfterAt: string | null;
                        usage: string;
                    };
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionContentFetchOperations: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Content fetch operations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentFetchOperationList"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionContentFetchOperation: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uri
                     * @description 仅允许公开 HTTPS URL。 运行时还会拒绝凭据、非默认端口、内网地址和敏感查询参数。
                     */
                    sourceUrl: string;
                    /** @enum {string} */
                    subjectChannel: "organization" | "individual";
                };
            };
        };
        responses: {
            /** @description Content fetch operation accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["content-fetch-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionContentFetchOperation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Content fetch operation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["content-fetch-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionImportOperations: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Import operations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportOperationList"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionImportOperation: {
        parameters: {
            query: {
                fileName: string;
                subjectChannel: "organization" | "individual";
                mapping: string;
            };
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        /** @description Raw CSV/XLSX only; application/json returns 415 unsupported_media_type. */
        requestBody: {
            content: {
                "text/csv": string;
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": string;
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Import operation accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["import-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionImportOperation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Import operation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["import-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionEvidence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Discovery evidence */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["discovery-evidence.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionPlan: {
        parameters: {
            query?: never;
            header: {
                /** @description 租户作用域内的写入幂等键；原文不会持久化。 */
                "Idempotency-Key": components["parameters"]["planIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    targetPlatform?: "douyin" | "web";
                    name: string;
                    objective: string;
                    icp: {
                        industries: string[];
                        regions: string[];
                        organizationCriteria: string[];
                        individualCriteria: string[];
                        exclusionRules: string[];
                    };
                    subjectChannels: {
                        organization: boolean;
                        individual: boolean;
                    };
                    providerConnections: {
                        connectionId: string;
                        providerId: string;
                        /** @enum {string} */
                        kind: "search" | "content_fetch" | "import";
                        /** @enum {string} */
                        status: "active" | "inactive" | "disabled";
                        credentialVersion: number;
                    }[];
                    operations: {
                        operationId: string;
                        /** @enum {string} */
                        subjectChannel: "organization" | "individual";
                        /** @enum {string} */
                        kind: "search" | "content_fetch" | "import_rows";
                        connectionId: string;
                        query?: string;
                        sourceRef?: string;
                        allocatedBudget: {
                            requests: number;
                            results: number;
                            amountMinor: number;
                            durationSeconds: number;
                        };
                    }[];
                    budgetSnapshot: {
                        billingCurrency: string;
                        maxRequests: number;
                        maxResults: number;
                        maxAmountMinor: number;
                        maxDurationSeconds: number;
                    };
                    /** @description 可选 BYOK 模型连接；服务端据此绑定不可伪造的模型快照。 */
                    modelConnectionId?: string | null;
                    stopConditions: {
                        stopWhenBudgetExhausted: boolean;
                        stopWhenNoMoreResults: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description Acquisition plan created */
            201: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-plan.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionPlan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Acquisition plan */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-plan.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    updateAcquisitionPlan: {
        parameters: {
            query?: never;
            header: {
                "If-Match": components["parameters"]["ifMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    targetPlatform?: "douyin" | "web";
                    name?: string;
                    objective?: string;
                    icp?: {
                        industries: string[];
                        regions: string[];
                        organizationCriteria: string[];
                        individualCriteria: string[];
                        exclusionRules: string[];
                    };
                    subjectChannels?: {
                        organization: boolean;
                        individual: boolean;
                    };
                    providerConnections?: {
                        connectionId: string;
                        providerId: string;
                        /** @enum {string} */
                        kind: "search" | "content_fetch" | "import";
                        /** @enum {string} */
                        status: "active" | "inactive" | "disabled";
                        credentialVersion: number;
                    }[];
                    operations?: {
                        operationId: string;
                        /** @enum {string} */
                        subjectChannel: "organization" | "individual";
                        /** @enum {string} */
                        kind: "search" | "content_fetch" | "import_rows";
                        connectionId: string;
                        query?: string;
                        sourceRef?: string;
                        allocatedBudget: {
                            requests: number;
                            results: number;
                            amountMinor: number;
                            durationSeconds: number;
                        };
                    }[];
                    budgetSnapshot?: {
                        billingCurrency: string;
                        maxRequests: number;
                        maxResults: number;
                        maxAmountMinor: number;
                        maxDurationSeconds: number;
                    };
                    modelSnapshotRef?: {
                        jobSnapshotId: string;
                        connectionId: string;
                        credentialVersion: number;
                        provider: string;
                        model: string;
                        capabilitySnapshotHash: string;
                        promptVersion: string;
                        schemaVersion: string;
                        promptHash: string;
                        schemaHash: string;
                    };
                    stopConditions?: {
                        stopWhenBudgetExhausted: boolean;
                        stopWhenNoMoreResults: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description Acquisition plan updated */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-plan.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionPlanRevision: {
        parameters: {
            query?: never;
            header: {
                "If-Match": components["parameters"]["ifMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    targetPlatform?: "douyin" | "web";
                    name?: string;
                    objective?: string;
                    icp?: {
                        industries: string[];
                        regions: string[];
                        organizationCriteria: string[];
                        individualCriteria: string[];
                        exclusionRules: string[];
                    };
                    subjectChannels?: {
                        organization: boolean;
                        individual: boolean;
                    };
                    providerConnections?: {
                        connectionId: string;
                        providerId: string;
                        /** @enum {string} */
                        kind: "search" | "content_fetch" | "import";
                        /** @enum {string} */
                        status: "active" | "inactive" | "disabled";
                        credentialVersion: number;
                    }[];
                    operations?: {
                        operationId: string;
                        /** @enum {string} */
                        subjectChannel: "organization" | "individual";
                        /** @enum {string} */
                        kind: "search" | "content_fetch" | "import_rows";
                        connectionId: string;
                        query?: string;
                        sourceRef?: string;
                        allocatedBudget: {
                            requests: number;
                            results: number;
                            amountMinor: number;
                            durationSeconds: number;
                        };
                    }[];
                    budgetSnapshot?: {
                        billingCurrency: string;
                        maxRequests: number;
                        maxResults: number;
                        maxAmountMinor: number;
                        maxDurationSeconds: number;
                    };
                    modelSnapshotRef?: {
                        jobSnapshotId: string;
                        connectionId: string;
                        credentialVersion: number;
                        provider: string;
                        model: string;
                        capabilitySnapshotHash: string;
                        promptVersion: string;
                        schemaVersion: string;
                        promptHash: string;
                        schemaHash: string;
                    };
                    stopConditions?: {
                        stopWhenBudgetExhausted: boolean;
                        stopWhenNoMoreResults: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description Acquisition plan revision created */
            201: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-plan.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    approveAcquisitionPlan: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "approve";
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Acquisition plan approved */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-plan.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionRun: {
        parameters: {
            query?: never;
            header: {
                /** @description 租户作用域内的写入幂等键；原文不会持久化。 */
                "Idempotency-Key": components["parameters"]["planIdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    parentRunId?: string;
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Acquisition run accepted */
            202: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-run.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Acquisition run */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-run.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionRunShards: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Acquisition run shards */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PagedResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionRunPresentation: {
        parameters: {
            query?: {
                after?: components["parameters"]["presentationAfter"];
                limit?: components["parameters"]["presentationLimit"];
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Acquisition run presentation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-run-presentation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    pauseAcquisitionRun: {
        parameters: {
            query?: never;
            header: {
                "If-Match": components["parameters"]["ifMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Acquisition run updated */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-run.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    resumeAcquisitionRun: {
        parameters: {
            query?: never;
            header: {
                "If-Match": components["parameters"]["ifMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Acquisition run updated */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-run.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    cancelAcquisitionRun: {
        parameters: {
            query?: never;
            header: {
                "If-Match": components["parameters"]["ifMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Acquisition run updated */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["acquisition-run.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionCandidates: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["acquisitionCursor"];
                limit?: components["parameters"]["acquisitionLimit"];
                subjectKind?: "organization" | "individual";
                status?: "discovered" | "unresolvable" | "normalized" | "qualified" | "pending_review" | "approved" | "rejected" | "do_not_contact" | "needs_research" | "converted_to_lead";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cursor-paginated candidates */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidatePagedResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionCandidate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Candidate */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Candidate"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionCandidateEvidence: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["acquisitionCursor"];
                limit?: components["parameters"]["acquisitionLimit"];
            };
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Candidate evidence */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscoveryEvidencePagedResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    confirmAcquisitionCandidateIdentity: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
                "If-Match": components["parameters"]["candidateIfMatch"];
            };
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    subjectKind: "organization";
                    domain: string | null;
                    creditCode: string | null;
                    evidenceIds: string[];
                    rationale: string;
                } | {
                    /** @enum {string} */
                    subjectKind: "individual";
                    /** Format: uri */
                    publicProfileUrl: string;
                    sourcePlatform: string;
                    evidenceIds: string[];
                    rationale: string;
                };
            };
        };
        responses: {
            /** @description Candidate identity confirmed */
            200: {
                headers: {
                    ETag: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityConfirmationResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionCandidateIntelligenceOperation: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path: {
                candidateId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Candidate intelligence operation accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["candidate-intelligence-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionCandidateIntelligenceOperation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Candidate intelligence operation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["candidate-intelligence-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getLatestAcquisitionCandidateIntelligenceOperation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidateId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Latest candidate intelligence operation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["candidate-intelligence-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    retryAcquisitionCandidateIntelligenceOperation: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path: {
                operationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Candidate intelligence operation retry accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["candidate-intelligence-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionCandidateQualification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Qualification decision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["qualification-decision.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionCandidateFinancialValue: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Financial value decision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["financial-value-decision.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionCandidateBattleCard: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Battle card */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BattleCard"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionCandidateReviews: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["acquisitionCursor"];
                limit?: components["parameters"]["acquisitionLimit"];
            };
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Review events */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReviewEventPagedResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    reviewAcquisitionCandidate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "approved" | "do_not_contact";
                    decisionVersion: string;
                    reason: string | null;
                } | {
                    /** @enum {string} */
                    action: "rejected" | "needs_research" | "reopen";
                    decisionVersion: string;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Candidate reviewed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateReviewResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    convertAcquisitionCandidate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    decisionVersion: string;
                };
            };
        };
        responses: {
            /** @description Candidate converted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LeadConversion"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionOutcomes: {
        parameters: {
            query: {
                cursor?: components["parameters"]["acquisitionCursor"];
                limit?: components["parameters"]["acquisitionLimit"];
                candidateId: components["parameters"]["candidateId"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Outcome feedback */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OutcomeFeedbackPagedResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionPerformance: {
        parameters: {
            query: {
                platform?: "douyin" | "web";
                from: string;
                to: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Acquisition performance */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AcquisitionPerformance"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAcquisitionCopilotSession: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    connectionId?: string | null;
                };
            };
        };
        responses: {
            /** @description Copilot session creation accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["async-operation.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionCopilotSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Copilot session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["copilot-session.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionCopilotMessages: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["acquisitionCursor"];
                limit?: components["parameters"]["acquisitionLimit"];
            };
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Copilot messages */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CopilotMessagePagedResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    sendAcquisitionCopilotMessage: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["idempotencyKey"];
            };
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    message: string;
                    /**
                     * @default assistant
                     * @enum {string}
                     */
                    responseMode?: "assistant" | "plan_draft";
                    /**
                     * @default web
                     * @enum {string}
                     */
                    targetPlatform?: "douyin" | "web";
                };
            };
        };
        responses: {
            /** @description Queued copilot task */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["copilot-task.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAcquisitionCopilotTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["acquisitionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Copilot task */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["copilot-task.v1.schema"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAcquisitionAuditEvents: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["acquisitionCursor"];
                limit?: components["parameters"]["acquisitionLimit"];
                candidateId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Audit events */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventPagedResult"];
                };
            };
            /** @description Unified API error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unified API error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
}
