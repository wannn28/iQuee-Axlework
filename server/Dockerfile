# syntax=docker/dockerfile:1
# ---- build ----
FROM golang:1.26-alpine AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/api ./cmd/api

# ---- run: static binary on scratch (~12 MB image) ----
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/api /api
USER 65532:65532
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 CMD ["/api", "-healthcheck"]
ENTRYPOINT ["/api"]
