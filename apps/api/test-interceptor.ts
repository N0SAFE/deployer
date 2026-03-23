import { OpenAPILink } from '@orpc/openapi-client/fetch'

const link = new OpenAPILink({} as any, {
    url: 'http://localhost',
    clientInterceptors: [
        ({ request, next }) => {
            console.log(request.url, request.method);
            return next().then(response => {
                console.log(response.status)
                return response
            })
        }
    ]
})
link.call(['users', 'list'], { id: 1 }, {})
