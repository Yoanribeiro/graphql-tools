import {
  subscribe,
  execute,
  validate,
  GraphQLSchema,
  ExecutionResult,
  isSchema,
  FieldDefinitionNode,
  getOperationAST,
  OperationTypeNode,
  OperationDefinitionNode,
  DocumentNode,
} from 'graphql';

import { mapAsyncIterator, CombinedError } from '@graphql-tools/utils';

import {
  IDelegateToSchemaOptions,
  IDelegateRequestOptions,
  SubschemaConfig,
  isSubschemaConfig,
  ExecutionParams,
} from './types';
import { createRequestFromInfo, getDelegatingOperation } from './createRequest';
import { Transformer } from './Transformer';

export function delegateToSchema(options: IDelegateToSchemaOptions | GraphQLSchema): any {
  if (isSchema(options)) {
    throw new Error(
      'Passing positional arguments to delegateToSchema is deprecated. ' + 'Please pass named parameters instead.'
    );
  }

  const {
    info,
    operation = getDelegatingOperation(info.parentType, info.schema),
    fieldName = info.fieldName,
    returnType = info.returnType,
    selectionSet,
    fieldNodes,
  } = options;

  const request = createRequestFromInfo({
    info,
    operation,
    fieldName,
    selectionSet,
    fieldNodes,
  });

  return delegateRequest({
    ...options,
    request,
    operation,
    fieldName,
    returnType,
  });
}

export function delegateRequest({
  request,
  schema: subschemaOrSubschemaConfig,
  rootValue,
  info,
  operation,
  fieldName,
  args,
  returnType,
  context,
  transforms = [],
  transformedSchema,
  skipValidation,
  skipTypeMerging,
  binding,
}: IDelegateRequestOptions) {
  let operationDefinition: OperationDefinitionNode;
  let targetOperation: OperationTypeNode;
  let targetFieldName: string;

  if (operation == null) {
    operationDefinition = getOperationAST(request.document, undefined);
    targetOperation = operationDefinition.operation;
  } else {
    targetOperation = operation;
  }

  if (fieldName == null) {
    operationDefinition = operationDefinition ?? getOperationAST(request.document, undefined);
    targetFieldName = ((operationDefinition.selectionSet.selections[0] as unknown) as FieldDefinitionNode).name.value;
  } else {
    targetFieldName = fieldName;
  }

  let targetSchema: GraphQLSchema;
  let targetRootValue: Record<string, any>;
  let subschemaConfig: SubschemaConfig;

  if (isSubschemaConfig(subschemaOrSubschemaConfig)) {
    subschemaConfig = subschemaOrSubschemaConfig;
    targetSchema = subschemaConfig.schema;
    targetRootValue = rootValue ?? subschemaConfig?.rootValue ?? info?.rootValue;
  } else {
    targetSchema = subschemaOrSubschemaConfig;
    targetRootValue = rootValue ?? info?.rootValue;
  }

  const delegationContext = {
    subschema: subschemaOrSubschemaConfig,
    targetSchema,
    operation: targetOperation,
    fieldName: targetFieldName,
    args,
    context,
    info,
    returnType,
    transforms,
    transformedSchema,
    skipTypeMerging,
  };

  const transformer = new Transformer(delegationContext, binding);

  const processedRequest = transformer.transformRequest(request);

  if (!skipValidation) {
    validateRequest(targetSchema, processedRequest.document);
  }

  if (targetOperation === 'query' || targetOperation === 'mutation') {
    const executor =
      subschemaConfig?.executor || createDefaultExecutor(targetSchema, subschemaConfig?.rootValue || targetRootValue);

    const executionResult = executor({
      document: processedRequest.document,
      variables: processedRequest.variables,
      context,
      info,
    });

    if (executionResult instanceof Promise) {
      return executionResult.then(originalResult => transformer.transformResult(originalResult));
    }
    return transformer.transformResult(executionResult);
  }

  const subscriber =
    subschemaConfig?.subscriber || createDefaultSubscriber(targetSchema, subschemaConfig?.rootValue || targetRootValue);

  return subscriber({
    document: processedRequest.document,
    variables: processedRequest.variables,
    context,
    info,
  }).then((subscriptionResult: AsyncIterableIterator<ExecutionResult> | ExecutionResult) => {
    if (Symbol.asyncIterator in subscriptionResult) {
      // "subscribe" to the subscription result and map the result through the transforms
      return mapAsyncIterator<ExecutionResult, any>(
        subscriptionResult as AsyncIterableIterator<ExecutionResult>,
        originalResult => ({
          [targetFieldName]: transformer.transformResult(originalResult),
        })
      );
    }

    return transformer.transformResult(subscriptionResult as ExecutionResult);
  });
}

function validateRequest(targetSchema: GraphQLSchema, document: DocumentNode) {
  const errors = validate(targetSchema, document);
  if (errors.length > 0) {
    if (errors.length > 1) {
      const combinedError = new CombinedError(errors);
      throw combinedError;
    }
    const error = errors[0];
    throw error.originalError || error;
  }
}

function createDefaultExecutor(schema: GraphQLSchema, rootValue: Record<string, any>) {
  return ({ document, context, variables, info }: ExecutionParams) =>
    execute({
      schema,
      document,
      contextValue: context,
      variableValues: variables,
      rootValue: rootValue ?? info?.rootValue,
    });
}

function createDefaultSubscriber(schema: GraphQLSchema, rootValue: Record<string, any>) {
  return ({ document, context, variables, info }: ExecutionParams) =>
    subscribe({
      schema,
      document,
      contextValue: context,
      variableValues: variables,
      rootValue: rootValue ?? info?.rootValue,
    }) as any;
}
