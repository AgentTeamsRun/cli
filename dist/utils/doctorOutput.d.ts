import type { DoctorResult } from '../commands/doctor.js';
export type DoctorOutputFormat = 'human' | 'json';
export declare function resolveDoctorExitCode(result: DoctorResult): 0 | 1;
export declare function printDoctorResult(result: DoctorResult, format: DoctorOutputFormat): void;
//# sourceMappingURL=doctorOutput.d.ts.map