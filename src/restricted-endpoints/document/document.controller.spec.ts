import { Test, TestingModule } from '@nestjs/testing';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocSuccess } from '../replication/replication-endpoints/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../session/user-auth.dto';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';

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
  const requestingUser = new UserInfo('username', ['user_app']);
  beforeEach(async () => {
    mockDocumentService = {
      getDocument: () => Promise.resolve(undefined),
      putDocument: () => Promise.resolve(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        ...authGuardMockProviders,
        { provide: DocumentService, useValue: mockDocumentService },
      ],
    }).compile();

    controller = module.get<DocumentController>(DocumentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call getDocument with the ID, the database name and the query params', async () => {
    jest
      .spyOn(mockDocumentService, 'getDocument')
      .mockReturnValue(Promise.resolve(document));
    const params = { first: 1, second: 2 };

    const response = controller.getDocument(
      databaseName,
      documentID,
      requestingUser,
      params,
    );

    await expect(response).resolves.toBe(document);
    expect(mockDocumentService.getDocument).toHaveBeenCalledWith(
      databaseName,
      documentID,
      requestingUser,
      params,
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
      requestingUser,
    );

    await expect(response).resolves.toBe(successResponse);
    expect(mockDocumentService.putDocument).toHaveBeenCalledWith(
      databaseName,
      document,
      requestingUser,
    );
  });
});
