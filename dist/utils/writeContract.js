/** create 계열용: `guideHash` + `idempotencyKey`. */
export const writeContractFields = (options) => {
    const fields = {};
    if (options.guideHash !== undefined)
        fields.guideHash = options.guideHash;
    if (options.idempotencyKey !== undefined)
        fields.idempotencyKey = options.idempotencyKey;
    return fields;
};
/** update/delete 계열용: create 계열 + `expectedUpdatedAt`. */
export const mutationContractFields = (options) => {
    const fields = writeContractFields(options);
    if (options.expectedUpdatedAt !== undefined)
        fields.expectedUpdatedAt = options.expectedUpdatedAt;
    return fields;
};
//# sourceMappingURL=writeContract.js.map