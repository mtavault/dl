export type APIResponse = {
  statusCode: number;
  data: {
    message?: string;

    id: string;
    seoFriendlyURL: string;
    name: string;
    [key: string]: any;
  };
  request: {
    method: string;
    url: string;
  };
};
