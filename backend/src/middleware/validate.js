/**
 * Zod validation middleware.
 *
 * - body/params: the parsed (and stripped!) value replaces the raw input, so
 *   unknown fields like a client-sent `timestamp` never reach controllers.
 * - query: stored on `req.validated.query`, because Express 5 exposes
 *   req.query as a getter-only property.
 */
export const validate = (schema, source = "body") => (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
        const issues = result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
        }));
        return res.status(400).json({
            // Name the failing field(s) so clients can react ("password:
            // Password must be at least 8 characters"), not just "Invalid input".
            message: `Invalid input: ${issues
                .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
                .join("; ")}`,
            issues,
        });
    }

    if (source === "query") {
        req.validated = { ...(req.validated || {}), query: result.data };
    } else {
        req[source] = result.data;
    }

    next();
};
