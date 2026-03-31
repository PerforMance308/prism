import { z } from 'zod';
export declare const AppConfigSchema: z.ZodObject<{
    server: z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        host: z.ZodDefault<z.ZodString>;
        corsOrigins: z.ZodDefault<z.ZodEffects<z.ZodUnion<[z.ZodArray<z.ZodString>, z.ZodString]>, string[], string[] | string>>;
    }, "strict", z.ZodTypeAny, {
        port: number;
        host: string;
        corsOrigins: string[];
    }, {
        port?: number | undefined;
        host?: string | undefined;
        corsOrigins?: string[] | string | undefined;
    }>;
    database: z.ZodObject<{
        url: z.ZodString;
        poolSize: z.ZodDefault<z.ZodNumber>;
        ssl: z.ZodDefault<z.ZodEffects<z.ZodUnion<[z.ZodBoolean, z.ZodString]>, boolean, string | boolean>>;
    }, "strict", z.ZodTypeAny, {
        url: string;
        poolSize: number;
        ssl: boolean;
    }, {
        url: string;
        poolSize?: number | undefined;
        ssl?: string | boolean | undefined;
    }>;
    redis: z.ZodObject<{
        url: z.ZodDefault<z.ZodString>;
        prefix: z.ZodDefault<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        url: string;
        prefix: string;
    }, {
        url?: string | undefined;
        prefix?: string | undefined;
    }>;
    llm: z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<["anthropic", "openai", "azure"]>>;
        apiKey: z.ZodString;
        model: z.ZodDefault<z.ZodString>;
        fallbackProvider: z.ZodOptional<z.ZodEnum<["anthropic", "openai", "azure"]>>;
    }, "strict", z.ZodTypeAny, {
        apiKey: string;
        provider: "anthropic" | "openai" | "azure";
        model: string;
        fallbackProvider?: "anthropic" | "openai" | "azure" | undefined;
    }, {
        apiKey: string;
        provider?: "anthropic" | "openai" | "azure" | undefined;
        model?: string | undefined;
        fallbackProvider?: "anthropic" | "openai" | "azure" | undefined;
    }>;
    proactive: z.ZodObject<{
        checkIntervalMs: z.ZodDefault<z.ZodNumber>;
        historySize: z.ZodDefault<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        checkIntervalMs: number;
        historySize: number;
    }, {
        checkIntervalMs?: number | undefined;
        historySize?: number | undefined;
    }>;
    security: z.ZodObject<{
        jwtSecret: z.ZodString;
        apiKeyHeader: z.ZodDefault<z.ZodString>;
        sessionTtl: z.ZodDefault<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        jwtSecret: string;
        apiKeyHeader: string;
        sessionTtl: number;
    }, {
        jwtSecret: string;
        apiKeyHeader?: string | undefined;
        sessionTtl?: number | undefined;
    }>;
    logging: z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
        format: z.ZodDefault<z.ZodEnum<["json", "text"]>>;
    }, "strict", z.ZodTypeAny, {
        level: "debug" | "info" | "warn" | "error";
        format: "json" | "text";
    }, {
        level?: "debug" | "info" | "warn" | "error" | undefined;
        format?: "json" | "text" | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    server: {
        port: number;
        host: string;
        corsOrigins: string[];
    };
    database: {
        url: string;
        poolSize: number;
        ssl: boolean;
    };
    redis: {
        url: string;
        prefix: string;
    };
    llm: {
        apiKey: string;
        provider: "anthropic" | "openai" | "azure";
        model: string;
        fallbackProvider?: "anthropic" | "openai" | "azure" | undefined;
    };
    proactive: {
        checkIntervalMs: number;
        historySize: number;
    };
    security: {
        jwtSecret: string;
        apiKeyHeader: string;
        sessionTtl: number;
    };
    logging: {
        level: "debug" | "info" | "warn" | "error";
        format: "json" | "text";
    };
}, {
    server: {
        port?: number | undefined;
        host?: string | undefined;
        corsOrigins?: string[] | string | undefined;
    };
    database: {
        url: string;
        poolSize?: number | undefined;
        ssl?: string | boolean | undefined;
    };
    redis: {
        url?: string | undefined;
        prefix?: string | undefined;
    };
    llm: {
        apiKey: string;
        provider?: "anthropic" | "openai" | "azure" | undefined;
        model?: string | undefined;
        fallbackProvider?: "anthropic" | "openai" | "azure" | undefined;
    };
    proactive: {
        checkIntervalMs?: number | undefined;
        historySize?: number | undefined;
    };
    security: {
        jwtSecret: string;
        apiKeyHeader?: string | undefined;
        sessionTtl?: number | undefined;
    };
    logging: {
        level?: "debug" | "info" | "warn" | "error" | undefined;
        format?: "json" | "text" | undefined;
    };
}>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
//# sourceMappingURL=schema.d.ts.map
