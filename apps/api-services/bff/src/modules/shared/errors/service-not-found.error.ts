/** Raised when a service's own `findById` answers null; the controller maps it to 404. */
export class ServiceNotFoundError extends Error {
	constructor(serviceId: string) {
		super(`Service ${serviceId} not found`);
		this.name = "ServiceNotFoundError";
	}
}
