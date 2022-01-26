import { Test, TestingModule } from '@nestjs/testing';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocSuccess } from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';

describe('DocumentController', () => {
  let controller: DocumentController;
  let mockDocumentService: DocumentService;
  const databaseName = '/_users';
  const documentID = `Doctype:someID`;
  const document = {
    _id: documentID,
    _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
  };
  const successResponse: DocSuccess = {
    ok: true,
    id: document._id,
    rev: document._rev,
  };
  const requestingUser = {
    name: 'username',
    role: ['user_app'],
  };
  beforeEach(async () => {
    mockDocumentService = {
      getDocument: () => Promise.resolve(undefined),
      putDocument: () => Promise.resolve(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [{ provide: DocumentService, useValue: mockDocumentService }],
    }).compile();

    controller = module.get<DocumentController>(DocumentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call getDocument with the ID and database name', async () => {
    jest
      .spyOn(mockDocumentService, 'getDocument')
      .mockReturnValue(Promise.resolve(document));

    const response = controller.getDocument(databaseName, documentID, {
      user: requestingUser,
    } as any);

    await expect(response).resolves.toBe(document);
    expect(mockDocumentService.getDocument).toHaveBeenCalledWith(
      databaseName,
      documentID,
      requestingUser,
    );
  });

  it('should set the _id of the document and pass it to the documentService', async () => {
    jest
      .spyOn(mockDocumentService, 'putDocument')
      .mockReturnValue(Promise.resolve(successResponse));

    const response = controller.putDocument(
      databaseName,
      documentID,
      { _rev: document._rev },
      {
        user: requestingUser,
      } as any,
    );

    await expect(response).resolves.toBe(successResponse);
    expect(mockDocumentService.putDocument).toHaveBeenCalledWith(
      databaseName,
      document,
      requestingUser,
    );
  });
});
