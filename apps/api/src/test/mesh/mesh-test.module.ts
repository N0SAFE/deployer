import { Injectable, Module } from "@nestjs/common";

// ===== SERVICE B2 MODULE =====
@Injectable()
class ServiceB2 {
    onModuleInit() {
        console.log("ServiceB2 initialized");
    }
}

@Module({
    providers: [ServiceB2],
    exports: [ServiceB2],
})
class ServiceB2Module {}

// ===== SERVICE A1 MODULE =====
@Injectable()
class ServiceA1 {
    constructor(private readonly serviceB2: ServiceB2) {}
    
    onModuleInit() {
        console.log("ServiceA1 initialized with ServiceB2:", !!this.serviceB2);
    }
}

@Module({
    imports: [ServiceB2Module],
    providers: [ServiceA1],
    exports: [ServiceA1],
})
class ServiceA1Module {}

// ===== SERVICE B1 MODULE =====
@Injectable()
class ServiceB1 {
    constructor(private readonly serviceA1: ServiceA1) {}
    
    onModuleInit() {
        console.log("ServiceB1 initialized with ServiceA1:", !!this.serviceA1);
    }
}

@Module({
    imports: [ServiceA1Module],
    providers: [ServiceB1],
    exports: [ServiceB1],
})
class ServiceB1Module {}

@Module({
    imports: [ServiceB1Module, ServiceB2Module]
})
class ServiceBModule {}

// ===== APP MODULE =====
@Module({
    imports: [ServiceBModule, ServiceA1Module],
})
export class AppModule {}
