export type MemberQuotaResponse = {
    data: {
        coAction: {
            daily: {
                used: number;
                limit: number;
            };
            monthly: {
                used: number;
                limit: number;
            };
        } | null;
    };
};
export declare function getMemberQuota(apiUrl: string, headers: Record<string, string>): Promise<MemberQuotaResponse["data"]>;
//# sourceMappingURL=member.d.ts.map