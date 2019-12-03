import * as bytes from 'bytes';
import * as http from 'http';
import { DiskStorage, DiskStorageOptions } from '../storages/disk-storage';
import { File, generateFileId, Metadata } from '../storages/file';
import { BaseStorage } from '../storages/storage';
import { ERRORS, fail } from '../util/errors';
import { getHeader, typeis } from '../util/http';
import { logger } from '../util/logger';
import { BaseHandler, Headers } from './base-handler';

const log = logger.extend('Tus');
export function serializeMetadata(obj: Metadata): string {
  return Object.entries(obj)
    .map(([key, value]) => `${key} ${Buffer.from(String(value)).toString('base64')}`)
    .toString();
}

export function parseMetadata(encoded: string): Metadata {
  const kvPairs = encoded.split(',').map(kv => kv.split(' '));
  const metadata = Object.create(null);
  for (const [key, value] of kvPairs) {
    if (!value || !key) return metadata;
    metadata[key] = Buffer.from(value, 'base64').toString();
  }
  return metadata;
}
/**
 * tus resumable upload protocol
 * @link https://github.com/tus/tus-resumable-upload-protocol/blob/master/protocol.md
 */
export class Tus<T extends BaseStorage> extends BaseHandler {
  storage: T | DiskStorage;
  constructor(config: { storage: T } | DiskStorageOptions) {
    super();
    this.storage = 'storage' in config ? config.storage : new DiskStorage(config);
    log('options: %o', config);
  }

  async options(req: http.IncomingMessage, res: http.ServerResponse): Promise<File> {
    const headers: Headers = {
      'Tus-Extension': 'creation,creation-with-upload,termination',
      'Tus-Version': '1.0.0',
      'Tus-Resumable': '1.0.0',
      'Tus-Max-Size': bytes.parse(this.storage.config.maxUploadSize || 0)
    };
    res.setHeader('Content-Length', 0);
    res.writeHead(204, headers);
    res.end();
    return Promise.resolve({} as File);
  }

  /**
   * Create File from request and send file url to client
   */
  async post(req: http.IncomingMessage, res: http.ServerResponse): Promise<File> {
    const metadataHeader = getHeader(req, 'upload-metadata');
    let file = new File(parseMetadata(metadataHeader));
    file.userId = this.getUserId(req);
    file.size = Number.parseInt(getHeader(req, 'upload-length'));
    if (Number.isNaN(file.size)) return fail(ERRORS.INVALID_FILE_SIZE);
    file.id = generateFileId(file);
    await this.storage.create(req, file);
    const headers: Headers = {
      Location: this.buildFileUrl(req, file),
      'Tus-Resumable': '1.0.0'
    };
    if (typeis(req, ['application/offset+octet-stream'])) {
      const start = 0;
      file = await this.storage.write({ ...file, start, body: req });
      headers['Upload-Offset'] = file.bytesWritten;
      file.status = file.bytesWritten === file.size ? 'completed' : 'part';
    }
    const statusCode = file.bytesWritten > 0 ? 200 : 201;
    this.send({ res, statusCode, headers });
    return file;
  }

  /**
   * Write chunk to file or/and return chunk offset
   */
  async patch(req: http.IncomingMessage, res: http.ServerResponse): Promise<File> {
    const path = this.getPath(req);
    if (!path) return fail(ERRORS.FILE_NOT_FOUND);
    const start = Number(getHeader(req, 'upload-offset'));
    const contentLength = +getHeader(req, 'content-length');
    const file = await this.storage.write({ start, path, body: req, contentLength });
    const headers: Headers = {
      'Upload-Offset': `${file.bytesWritten}`,
      'Tus-Resumable': '1.0.0'
    };
    this.send({ res, statusCode: 204, headers });
    file.status = file.bytesWritten === file.size ? 'completed' : 'part';
    return file;
  }

  async head(req: http.IncomingMessage, res: http.ServerResponse): Promise<File> {
    const path = this.getPath(req);
    if (!path) return fail(ERRORS.FILE_NOT_FOUND);
    const file = await this.storage.write({ path });
    const headers: Headers = {
      'Upload-Offset': `${file.bytesWritten}`,
      'Upload-Metadata': serializeMetadata(file.metadata),
      'Tus-Resumable': '1.0.0'
    };
    this.send({ res, statusCode: 204, headers });
    return file;
  }

  /**
   * Delete upload by id
   */
  async delete(req: http.IncomingMessage, res: http.ServerResponse): Promise<File> {
    const path = this.getPath(req);
    if (!path) return fail(ERRORS.FILE_NOT_FOUND);
    const [file] = await this.storage.delete(path);
    const headers: Headers = { 'Tus-Resumable': '1.0.0' };
    this.send({ res, statusCode: 204, headers });
    file.status = 'deleted';
    return file;
  }
}

/**
 * Basic express wrapper
 */
export function tus(
  options: DiskStorageOptions = {}
): (req: http.IncomingMessage, res: http.ServerResponse, next: Function) => void {
  return new Tus(options).handle;
}
